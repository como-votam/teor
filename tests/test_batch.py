import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from teor.batch import BatchAdapter, import_responses, prepare
from teor.io import read_jsonl, write_json, write_jsonl


@pytest.fixture
def simple_item(items):
    return next(i for i in items if i.track == "C" and i.task == "yes_count")


def batch_config(model="mock-model", family="gemini"):
    return {
        "region": "test-region",
        "family": family,
        "bucket": "test-bucket",
        "project": "test-project",
        "role_arn": "arn:aws:iam::123456789012:role/test",
        "endpoint": "https://test.openai.azure.com",
        "capabilities": {
            "model": model,
            "batch": True,
            "region": "test-region",
            "as_of": "2026-10-09",
        },
    }


@pytest.mark.parametrize(
    "provider", ["openai", "anthropic", "gemini", "vertex", "bedrock", "azure"]
)
def test_each_provider_prepares_and_imports_out_of_order(simple_item, tmp_path, provider):
    price = {"input_per_million": 1, "output_per_million": 2, "max_input_tokens": 10000}
    root = tmp_path / provider
    job = prepare([simple_item], provider, "mock-model", root, batch_config(), price, 1)
    requests = read_jsonl(root / "requests.jsonl")
    rows = []
    for row in reversed(requests):
        text = json.dumps({"value": simple_item.answer.value, "abstain": False})
        if provider in ("openai", "azure"):
            response = {
                "custom_id": row["custom_id"],
                "response": {
                    "body": {
                        "choices": [{"message": {"content": text}}],
                        "usage": {"prompt_tokens": 12, "completion_tokens": 5},
                    }
                },
            }
        elif provider == "anthropic":
            response = {
                "custom_id": row["custom_id"],
                "result": {
                    "type": "succeeded",
                    "message": {
                        "content": [{"text": text}],
                        "usage": {"input_tokens": 12, "output_tokens": 5},
                    },
                },
            }
        elif provider in ("gemini", "vertex"):
            response = {
                "key": row.get("key"),
                "request": row["request"],
                "response": {
                    "candidates": [{"content": {"parts": [{"text": text}]}}],
                    "usageMetadata": {"promptTokenCount": 12, "candidatesTokenCount": 5},
                },
            }
        else:
            response = {
                "recordId": row["recordId"],
                "modelOutput": {
                    "output": {"message": {"content": [{"text": text}]}},
                    "usage": {"inputTokens": 12, "outputTokens": 5},
                },
            }
        rows.append(response)
    write_jsonl(root / "responses.jsonl", rows)
    output = tmp_path / f"{provider}.jsonl"
    predictions = import_responses(root, root / "responses.jsonl", output)
    assert [p.variant for p in predictions] == [0, 1, 2]
    assert all(p.response == 1 and p.input_tokens == 12 and p.status == "ok" for p in predictions)
    assert import_responses(root, root / "responses.jsonl", output) == predictions
    assert prepare([simple_item], provider, "mock-model", root, batch_config(), price, 1) == job


def test_batch_rejects_unsupported_region_and_tools(simple_item, items, tmp_path):
    price = {"input_per_million": 1, "output_per_million": 2, "max_input_tokens": 10000}
    config = batch_config()
    config["region"] = "different"
    with pytest.raises(ValueError, match="região"):
        prepare([simple_item], "vertex", "mock-model", tmp_path, config, price, 1)
    with pytest.raises(ValueError, match="interativa"):
        prepare(
            [next(i for i in items if i.track == "G")],
            "openai",
            "mock-model",
            tmp_path,
            batch_config(),
            price,
            1,
        )
    with pytest.raises(ValueError, match="orçamento"):
        prepare([simple_item], "openai", "mock-model", tmp_path, batch_config(), price, 0.001)


def test_partial_failure_and_conflicting_results(simple_item, tmp_path):
    prepare(
        [simple_item],
        "openai",
        "mock-model",
        tmp_path,
        batch_config(),
        {"input_per_million": 1, "output_per_million": 2, "max_input_tokens": 10000},
        1,
    )
    key = read_jsonl(tmp_path / "requests.jsonl")[0]["custom_id"]
    source, output = tmp_path / "responses.jsonl", tmp_path / "predictions.jsonl"
    write_jsonl(source, [{"custom_id": key, "response": None, "error": {"code": "batch_expired"}}])
    assert import_responses(tmp_path, source, output)[0].status == "infrastructure_error"
    write_jsonl(source, [{"custom_id": "unknown", "response": {}}])
    with pytest.raises(ValueError, match="identidade"):
        import_responses(tmp_path, source, output)


@pytest.mark.parametrize("provider", ["openai", "azure"])
def test_openai_submit_status_cancel_and_no_resubmission(
    simple_item, tmp_path, monkeypatch, provider
):
    prepare(
        [simple_item],
        provider,
        "mock-model",
        tmp_path,
        batch_config(),
        {"input_per_million": 1, "output_per_million": 2, "max_input_tokens": 10000},
        1,
    )
    client = MagicMock()
    client.files.create.return_value = SimpleNamespace(id="file-test")
    client.batches.create.return_value = SimpleNamespace(id="batch-test")
    client.batches.retrieve.return_value.model_dump.return_value = {
        "status": "completed",
        "output_file_id": "out",
    }
    client.files.content.return_value.content = b'{"custom_id":"test"}\n'
    monkeypatch.setattr(BatchAdapter, "openai_client", lambda _: client)
    adapter = BatchAdapter(tmp_path)
    assert adapter.submit()["remote_id"] == "batch-test"
    adapter.submit()
    assert client.batches.create.call_count == 1
    assert adapter.status()["state"] == "completed"
    assert adapter.download().exists()
    assert adapter.cancel()["state"] == "cancelling"


def test_bedrock_request_converse_and_cancellation(simple_item, tmp_path, monkeypatch):
    prepare(
        [simple_item],
        "bedrock",
        "mock-model",
        tmp_path,
        batch_config(),
        {"input_per_million": 1, "output_per_million": 2, "max_input_tokens": 10000},
        1,
    )
    bedrock, s3 = MagicMock(), MagicMock()
    bedrock.create_model_invocation_job.return_value = {"jobArn": "arn:test:job"}
    bedrock.get_model_invocation_job.return_value = {"status": "Completed"}
    monkeypatch.setattr(BatchAdapter, "aws", lambda _: (bedrock, s3))
    adapter = BatchAdapter(tmp_path)
    adapter.submit()
    assert bedrock.create_model_invocation_job.call_args.kwargs["modelInvocationType"] == "Converse"
    adapter.cancel()
    bedrock.stop_model_invocation_job.assert_called_once_with(jobIdentifier="arn:test:job")


def test_interrupted_submission_requires_reconciliation(simple_item, tmp_path):
    job = prepare(
        [simple_item],
        "gemini",
        "mock-model",
        tmp_path,
        batch_config(),
        {"input_per_million": 1, "output_per_million": 2, "max_input_tokens": 10000},
        1,
    )
    job["state"] = "submitting"
    write_json(tmp_path / "job.json", job)
    with pytest.raises(ValueError, match="reconcilie"):
        BatchAdapter(tmp_path).submit()


@pytest.mark.parametrize("provider", ["anthropic", "gemini", "vertex"])
def test_cloud_submit_status_download_cancel(simple_item, tmp_path, monkeypatch, provider):
    prepare(
        [simple_item],
        provider,
        "mock-model",
        tmp_path,
        batch_config(),
        {"input_per_million": 1, "output_per_million": 2, "max_input_tokens": 10000},
        1,
    )
    client = MagicMock()
    if provider == "anthropic":
        module = pytest.importorskip("anthropic")
        monkeypatch.setattr(module, "Anthropic", lambda: client)
        client.messages.batches.create.return_value = SimpleNamespace(id="batch-test")
        client.messages.batches.retrieve.return_value.model_dump.return_value = {
            "processing_status": "ended"
        }
        response = MagicMock()
        response.model_dump.return_value = {"custom_id": "test", "result": {"type": "expired"}}
        client.messages.batches.results.return_value = [response]
    elif provider == "gemini":
        client.files.upload.return_value = SimpleNamespace(name="input-file")
        client.batches.create.return_value = SimpleNamespace(name="batch-test")
        client.batches.get.return_value.model_dump.return_value = {
            "state": "JOB_STATE_SUCCEEDED",
            "dest": {"file_name": "output-file"},
        }
        client.files.download.return_value = b"{}\n"
        monkeypatch.setattr(BatchAdapter, "google_client", lambda _: client)
    else:
        storage = pytest.importorskip("google.cloud.storage")
        from google.cloud.aiplatform_v1.types import BatchPredictionJob

        bucket = MagicMock()
        monkeypatch.setattr(storage, "Client", lambda **_: bucket)
        blob = SimpleNamespace(name="predictions.jsonl", download_as_bytes=lambda: b"{}\n")
        bucket.list_blobs.return_value = [blob]
        client.create_batch_prediction_job.return_value = SimpleNamespace(name="batch-test")
        client.get_batch_prediction_job.return_value = BatchPredictionJob(
            name="batch-test", state=4
        )
        monkeypatch.setattr(BatchAdapter, "vertex_client", lambda _: client)
    adapter = BatchAdapter(tmp_path)
    assert adapter.submit()["remote_id"] == "batch-test"
    assert adapter.download().stat().st_size > 0
    assert adapter.cancel()["state"] == "cancelling"


def test_anthropic_expired_is_infrastructure(simple_item, tmp_path):
    prepare(
        [simple_item],
        "anthropic",
        "mock-model",
        tmp_path,
        batch_config(),
        {"input_per_million": 1, "output_per_million": 2, "max_input_tokens": 10000},
        1,
    )
    key = read_jsonl(tmp_path / "requests.jsonl")[0]["custom_id"]
    source = tmp_path / "responses.jsonl"
    write_jsonl(source, [{"custom_id": key, "result": {"type": "expired"}}])
    assert (
        import_responses(tmp_path, source, tmp_path / "predictions.jsonl")[0].status
        == "infrastructure_error"
    )
