"""O provedor mock do Inspect exercita o framework sem sair da máquina ou cobrar tokens."""

import asyncio
import json

import pytest

from teor.io import write_json
from teor.runner import run


def test_inspect_runs_and_recovers_without_remote_calls(items, tmp_path, monkeypatch):
    inspect_ai = pytest.importorskip("inspect_ai")
    from inspect_ai.model import ModelOutput, get_model

    item = next(i for i in items if i.track == "C" and i.task == "yes_count")
    original = inspect_ai.eval_async
    output = tmp_path / "predictions.jsonl"
    prices = tmp_path / "prices.json"
    write_json(
        prices,
        {
            "as_of": "2026-10-09",
            "models": {
                "mockllm/model": {
                    "input_per_million": 1,
                    "output_per_million": 2,
                    "max_input_tokens": 10000,
                }
            },
        },
    )
    calls = []

    def mock(messages, tools, choice, config):
        calls.append(messages)
        return ModelOutput.from_content("mockllm/model", json.dumps({"value": item.answer.value}))

    async def evaluate(task, **kwargs):
        kwargs["model"] = get_model("mockllm/model", custom_outputs=mock, memoize=False)
        return await original(task, **kwargs)

    monkeypatch.setattr(inspect_ai, "eval_async", evaluate)
    first = asyncio.run(run([item], "mockllm/model", output, prices, 1))
    assert len(first) == 3 and all(
        p.status == "ok" and p.response == item.answer.value for p in first
    )
    assert all(p.input_tokens > 0 and p.cost_usd is not None for p in first)
    output.unlink()
    second = asyncio.run(run([item], "mockllm/model", output, prices, 1))
    assert sorted(first, key=lambda p: p.variant) == sorted(second, key=lambda p: p.variant)
    assert len(calls) == 3


def test_tool_loop_budget_reserved_before_any_call(items, tmp_path):
    pytest.importorskip("inspect_ai")
    prices = tmp_path / "prices.json"
    write_json(
        prices,
        {
            "as_of": "2026-10-09",
            "models": {
                "mockllm/model": {
                    "input_per_million": 1,
                    "output_per_million": 2,
                    "max_input_tokens": 10000,
                }
            },
        },
    )
    item = next(i for i in items if i.track == "G")
    with pytest.raises(ValueError, match="orçamento"):
        asyncio.run(
            run(
                [item],
                "mockllm/model",
                tmp_path / "p.jsonl",
                prices,
                0.1,
                api_url="http://localhost:8000",
            )
        )


def test_inspect_tool_round_trip(items, tmp_path, monkeypatch):
    inspect_ai = pytest.importorskip("inspect_ai")
    import httpx
    from inspect_ai.model import ChatCompletionChoice, ChatMessageAssistant, ModelOutput, get_model
    from inspect_ai.tool import ToolCall

    item = next(i for i in items if i.track == "G")
    prices = tmp_path / "prices.json"
    write_json(
        prices,
        {
            "as_of": "2026-10-09",
            "models": {
                "mockllm/model": {
                    "input_per_million": 1,
                    "output_per_million": 2,
                    "max_input_tokens": 10000,
                }
            },
        },
    )
    original_client = httpx.AsyncClient
    requested = []

    def handle(request):
        assert request.url.host == "snapshot.test"
        requested.append(str(request.url))
        return httpx.Response(200, json={"votes": [{"vote": "Sim"}, {"vote": "Não"}]})

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs),
    )

    def mock(messages, tools, choice, config):
        if messages[-1].role == "tool":
            return ModelOutput.from_content("mockllm/model", '{"value":1}')
        return ModelOutput(
            model="mockllm/model",
            choices=[
                ChatCompletionChoice(
                    message=ChatMessageAssistant(
                        content="",
                        tool_calls=[
                            ToolCall(
                                id="lookup",
                                function="snapshot_record",
                                arguments={"record_id": item.context["record_id"]},
                            )
                        ],
                    ),
                    stop_reason="tool_calls",
                )
            ],
        )

    original_eval = inspect_ai.eval_async

    async def evaluate(task, **kwargs):
        kwargs["model"] = get_model("mockllm/model", custom_outputs=mock, memoize=False)
        return await original_eval(task, **kwargs)

    monkeypatch.setattr(inspect_ai, "eval_async", evaluate)
    result = asyncio.run(
        run(
            [item],
            "mockllm/model",
            tmp_path / "tools.jsonl",
            prices,
            1,
            api_url="https://snapshot.test",
        )
    )
    assert len(requested) == 3
    assert all(p.status == "ok" and p.response == 1 and p.tool_calls == 1 for p in result)


def test_prompt_declares_value_format_without_leaking_answer(items):
    from teor.runner import FORMAT_HINTS, SYSTEM, request_prompt

    assert '"value"' in SYSTEM and '"abstain"' in SYSTEM
    for item in items:
        prompt = request_prompt(item, 0)
        assert FORMAT_HINTS[item.answer.type] in prompt
        assert ("snapshot_record" in prompt) == (item.track == "G")
    item = next(i for i in items if i.answer.type == "integer")
    assert "Formato da resposta" in request_prompt(item, 0)


def test_preflight_covers_each_format_once_and_skips_tools(items):
    from teor.runner import preflight_items

    chosen = preflight_items(items)
    keys = [(i.track, i.answer.type) for i in chosen]
    assert len(keys) == len(set(keys))
    assert all(i.track != "G" and i.answerable for i in chosen)


def test_record_id_is_extracted_from_pasted_json_block():
    from teor.runner import clean_record_id

    assert clean_record_id('{\n  "record_id": "senado:votacao:7104"\n}') == "senado:votacao:7104"
    assert clean_record_id(" camara:proposicao:1\n") == "camara:proposicao:1"
    assert clean_record_id("{quebrado") == "{quebrado"
