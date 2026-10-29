"""CLI com artefatos explícitos: publicar é uma decisão diferente de coletar e pontuar."""

import asyncio
from datetime import date, datetime
from pathlib import Path
from typing import Annotated

import typer

from teor import models
from teor.build import build_dataset, export_dataset, load_items, validate_items
from teor.io import immutable_cache_copy, read_json, read_jsonl, write_json, write_jsonl
from teor.models import Judgement, Prediction, Result, Review
from teor.scoring import aggregate, baselines

app = typer.Typer(
    help="Teor — benchmark aberto do processo legislativo brasileiro", no_args_is_help=True
)
(
    snapshot_app,
    batch_app,
    round_app,
    review_app,
    submission_app,
    site_app,
    github_app,
    calibration_app,
    agent_app,
) = [typer.Typer(no_args_is_help=True) for _ in range(9)]
for name, group in (
    ("snapshot", snapshot_app),
    ("batch", batch_app),
    ("round", round_app),
    ("review", review_app),
    ("submission", submission_app),
    ("site", site_app),
    ("github", github_app),
    ("calibration", calibration_app),
    ("agent", agent_app),
):
    app.add_typer(group, name=name)


def predictions(path: Path) -> list[Prediction]:
    return [Prediction.model_validate(row) for row in read_jsonl(path)]


@app.command()
def collect(
    start: str = "2026-09-01",
    end: str = "2026-09-30",
    output: Path = Path("data/setembro-2026"),
    resume_from: Path | None = None,
) -> None:
    """Coleta as duas casas com retomada a partir do cache local."""
    from teor.sources import Collector

    if resume_from:
        import shutil

        if output.exists():
            raise typer.BadParameter("Retomada exige destino novo para preservar snapshots")
        shutil.copytree(resume_from / "raw", output / "raw", copy_function=immutable_cache_copy)
        if (resume_from / "documents").exists():
            shutil.copytree(
                resume_from / "documents", output / "documents", copy_function=immutable_cache_copy
            )
    value = asyncio.run(
        Collector(output, date.fromisoformat(start), date.fromisoformat(end)).collect()
    )
    typer.echo(
        f"Snapshot {value.id}: {value.state}; cobertura={value.coverage}; lacunas={len(value.gaps)}"
    )
    if value.state != "complete":
        raise typer.Exit(2)


@snapshot_app.command("verify")
def snapshot_verify(root: Path) -> None:
    from teor.sources import verify_snapshot

    manifest = verify_snapshot(root)
    typer.echo(f"Hashes válidos; estado={manifest.state}")


@app.command("build")
def build(
    root: Path,
    output: Path = Path("data/benchmark"),
    config: Path = Path("config/build.json"),
    rules: Path = Path("config/rules.json"),
) -> None:
    typer.echo(build_dataset(root, output, config, rules))


@app.command()
def validate(items: Path) -> None:
    rows = load_items(items)
    validate_items(rows)
    typer.echo(f"{len(rows)} itens válidos")


@app.command("export")
def export_data(items: Path, output: Path = Path("exports/dataset")) -> None:
    """Prepara JSONL, Parquet e dataset card para publicação posterior no HF."""
    export_dataset(load_items(items), output)


@app.command("schemas")
def schemas(output: Path = Path("docs/schemas")) -> None:
    for name in ("Snapshot", "Item", "PublicQuestion", "Prediction", "Result", "Round", "Review"):
        write_json(
            output / f"{name.lower()}.schema.json", getattr(models, name).model_json_schema()
        )


@app.command("baseline")
def baseline(
    items: Path,
    dev: Path,
    output: Path = Path("data/baseline.jsonl"),
    method: str = "random",
    seed: int = 2026,
) -> None:
    write_jsonl(output, baselines(load_items(items), load_items(dev), method, seed))


@app.command("score")
def score(
    items: Path,
    answers: Path,
    output: Path = Path("reports/result.json"),
    reviews: Path | None = None,
    config: Path | None = None,
) -> None:
    rows, preds = load_items(items), predictions(answers)
    result = aggregate(rows, preds, read_json(config) if config else None)
    if reviews:
        from teor.operations import attach_human_reviews

        result = attach_human_reviews(
            rows, preds, result, [Review.model_validate(r) for r in read_jsonl(reviews)]
        )
    write_json(output, result)
    typer.echo(f"Resultado {result.id}; completo={result.complete}; métricas={len(result.metrics)}")


@app.command("report")
def report(result: Path, output: Path = Path("reports/result.md")) -> None:
    value = Result.model_validate(read_json(result))
    lines = [
        f"# {value.model}",
        "",
        f"Cobertura: {value.usage['coverage']:.1%}. Status: {value.verification}.",
        "",
        "| Trilha | Tarefa | Casa | Modo | Métrica | Média | IC 95% |",
        "|---|---|---|---|---|---|---|",
    ]
    for metric in value.metrics:
        for name in ("score", "brier", "citation_validity"):
            if name in metric:
                score = metric[name]
                lines.append(
                    f"| {metric['track']} | {metric['task']} | {metric['chamber']} | {metric['mode']} | {name} | {score['mean']:.3f} | {score['ci95']} |"
                )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


@app.command("run")
def run_command(
    items: Path,
    model: str,
    prices: Path,
    budget: float,
    output: Path = Path("data/predictions.jsonl"),
    max_output: int = 1024,
    concurrency: int = 2,
    api_url: str | None = None,
    base_url: str | None = None,
    preflight: bool = typer.Option(
        True,
        help="Roda um lote mínimo de cada formato e aborta antes do run caro se o formato falhar.",
    ),
    preflight_max_invalid: float = 0.15,
    preflight_only: bool = typer.Option(
        False, help="Roda só o preflight (algumas dezenas de chamadas) e encerra."
    ),
) -> None:
    from teor.runner import preflight as run_preflight
    from teor.runner import run

    if budget <= 0 or concurrency < 1 or max_output < 1:
        raise typer.BadParameter("Orçamento, concorrência e saída devem ser positivos")
    loaded = load_items(items)
    if preflight_only:
        preflight = True
    if preflight:
        try:
            report = asyncio.run(
                run_preflight(
                    loaded,
                    model,
                    output,
                    prices,
                    budget,
                    max_output,
                    concurrency,
                    preflight_max_invalid,
                    base_url,
                )
            )
        except ValueError as error:
            typer.echo(str(error), err=True)
            raise typer.Exit(1) from error
        typer.echo(
            f"Preflight ok: {report['invalid']}/{report['calls']} fora do formato ({report['rate']:.0%})"
        )
        if preflight_only:
            return
    values = asyncio.run(
        run(
            loaded,
            model,
            output,
            prices,
            budget,
            max_output,
            concurrency,
            api_url,
            base_url,
        )
    )
    typer.echo(f"{len(values)} previsões gravadas")


@agent_app.command("prepare")
def agent_prepare(items: Path, output: Path = Path("data/agent-prompts.jsonl")) -> None:
    """Gera os prompts sem gabarito: é o único arquivo que a máquina do agente precisa."""
    from teor.agents import prompt_rows

    rows = prompt_rows(load_items(items))
    write_jsonl(output, rows)
    typer.echo(f"{len(rows)} prompts em {output}")


@agent_app.command("run")
def agent_run(
    prompts: Path,
    agent: str,
    model: str,
    budget: float,
    output: Path = Path("data/agent-predictions.jsonl"),
    isolation: str = typer.Option("workdir", help="workdir | sandbox-exec | external"),
    api_url: str | None = None,
    concurrency: int = 1,
    timeout: int = 300,
    deny_read: Annotated[
        list[Path] | None, typer.Option(help="Caminhos extras com leitura negada")
    ] = None,
    prices: Annotated[Path | None, typer.Option(help="JSON com input/output por milhão")] = None,
    max_calls: int | None = None,
    preflight: bool = True,
    preflight_max_invalid: float = 0.15,
    preflight_only: bool = False,
) -> None:
    """Roda um agente de código (claude, codex, cursor) sobre os prompts, um processo por chamada."""
    from teor.agents import agent_config, load_prompts, preflight_rows, run_agent

    if budget <= 0 or concurrency < 1:
        raise typer.BadParameter("Orçamento e concorrência devem ser positivos")
    rows = load_prompts(prompts)
    price = read_json(prices) if prices else None
    options = dict(
        isolation=isolation,
        api_url=api_url,
        concurrency=concurrency,
        timeout=timeout,
        deny_read=deny_read or [],
        price=price,
    )
    try:
        if preflight or preflight_only:
            sample = preflight_rows(rows)
            done = run_agent(
                sample,
                agent,
                model,
                output.with_name(output.stem + ".preflight.jsonl"),
                budget,
                **options,
            )
            invalid = [p for p in done if p.status != "ok"]
            rate = len(invalid) / max(len(done), 1)
            typer.echo(f"Preflight: {len(invalid)}/{len(done)} fora do formato ({rate:.0%})")
            if rate > preflight_max_invalid:
                for p in invalid[:5]:
                    typer.echo(f"  {p.item_id}:{p.variant} [{p.status}] {p.error or ''}", err=True)
                raise ValueError("Preflight reprovado; nada além dele foi gasto")
            if preflight_only:
                return
        values = run_agent(rows, agent, model, output, budget, max_calls=max_calls, **options)
    except ValueError as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(1) from error
    write_json(output.with_suffix(".config.json"), agent_config(output))
    typer.echo(
        f"{len(values)} previsões em {output}; config em {output.with_suffix('.config.json')}"
    )


@app.command("serve")
def serve(root: Path, host: str = "127.0.0.1", port: int = 8000, cutoff: str | None = None) -> None:
    import uvicorn

    from teor.server import create_app

    uvicorn.run(
        create_app(root, datetime.fromisoformat(cutoff) if cutoff else None), host=host, port=port
    )


@batch_app.command("prepare")
def batch_prepare(
    items: Path,
    provider: str,
    model: str,
    config: Path,
    prices: Path,
    budget: float,
    output: Path = Path("data/batch"),
    max_output: int = 1024,
) -> None:
    from teor.batch import prepare

    price = read_json(prices)["models"].get(model)
    if price is None:
        raise typer.BadParameter("Modelo ausente do arquivo de preços")
    typer.echo(
        prepare(
            load_items(items), provider, model, output, read_json(config), price, budget, max_output
        )["id"]
    )


@batch_app.command("submit")
def batch_submit(root: Path) -> None:
    from teor.batch import BatchAdapter

    typer.echo(BatchAdapter(root).submit()["remote_id"])


@batch_app.command("status")
def batch_status(root: Path) -> None:
    from teor.batch import BatchAdapter

    typer.echo(BatchAdapter(root).status()["state"])


@batch_app.command("cancel")
def batch_cancel(root: Path) -> None:
    from teor.batch import BatchAdapter

    typer.echo(BatchAdapter(root).cancel()["state"])


@batch_app.command("import")
def batch_import(
    root: Path, output: Path = Path("data/batch-predictions.jsonl"), source: Path | None = None
) -> None:
    from teor.batch import BatchAdapter, import_responses

    typer.echo(len(import_responses(root, source or BatchAdapter(root).download(), output)))


@round_app.command("create")
def round_create(
    items: Path, name: str, opens_at: str, closes_at: str, output: Path = Path("private/round")
) -> None:
    from teor.operations import create_round

    typer.echo(
        create_round(
            load_items(items),
            output,
            name,
            datetime.fromisoformat(opens_at),
            datetime.fromisoformat(closes_at),
        ).id
    )


@round_app.command("export")
def round_export(root: Path, output: Path = Path("exports/round")) -> None:
    from teor.operations import export_round

    export_round(root, output)


@round_app.command("close")
def round_close(root: Path) -> None:
    from teor.operations import close_round

    typer.echo(close_round(root).state)


@round_app.command("publish")
def round_publish(root: Path, output: Path = Path("exports/round-closed")) -> None:
    from teor.operations import publish_round

    typer.echo(publish_round(root, output).state)


@review_app.command("export")
def review_export(
    items: Path, output: Path = Path("private/review"), answers: Path | None = None
) -> None:
    from teor.operations import export_reviews

    export_reviews(load_items(items), output, predictions(answers) if answers else None)


@review_app.command("import")
def review_import(source: Path, output: Path = Path("private/reviews.jsonl")) -> None:
    from teor.operations import import_reviews

    typer.echo(len(import_reviews(source, output)))


@review_app.command("adjudicate")
def review_adjudicate(
    item_id: str,
    reviewer: str,
    judgement: Judgement,
    evidence: str,
    output: Path = Path("private/reviews.jsonl"),
    prediction_id: str | None = None,
    claim_index: int | None = None,
    item_hash: str | None = None,
) -> None:
    from datetime import UTC

    from teor.operations import review_report

    rows = [Review.model_validate(r) for r in read_jsonl(output)]
    rows.append(
        Review(
            item_id=item_id,
            item_hash=item_hash,
            reviewer=reviewer,
            judgement=judgement,
            evidence=evidence,
            adjudication=True,
            reviewed_at=datetime.now(UTC),
            prediction_id=prediction_id,
            claim_index=claim_index,
        )
    )  # type: ignore[arg-type]
    review_report(rows)
    write_jsonl(output, rows)


@review_app.command("report")
def reviews_report(source: Path, output: Path = Path("reports/reviews.json")) -> None:
    from teor.operations import review_report

    write_json(output, review_report([Review.model_validate(r) for r in read_jsonl(source)]))


@review_app.command("promote")
def review_promote(items: Path, reviews: Path, output: Path = Path("private/gold")) -> None:
    from teor.operations import promote_gold

    typer.echo(
        promote_gold(
            load_items(items), [Review.model_validate(r) for r in read_jsonl(reviews)], output
        )
    )


@app.command("errata")
def errata(items: Path, corrections: Path, output: Path) -> None:
    from teor.operations import apply_errata

    typer.echo(apply_errata(load_items(items), read_jsonl(corrections), output))


@submission_app.command("validate")
def submission_validate(
    items: Path,
    answers: Path,
    result: Path,
    round_file: Path | None = None,
    reviews: Path | None = None,
) -> None:
    from teor.operations import validate_submission

    validate_submission(
        load_items(items),
        predictions(answers),
        Result.model_validate(read_json(result)),
        round_file,
        [Review.model_validate(r) for r in read_jsonl(reviews)] if reviews else None,
    )
    typer.echo("Submissão autodeclarada consistente")


@site_app.command("export")
def site_export(
    items: Path,
    results: Path = Path("results"),
    output: Path = Path("site"),
    answers: Path | None = None,
    rounds: Path | None = None,
) -> None:
    from teor.site import export_site

    typer.echo(
        export_site(
            load_items(items), results, output, predictions(answers) if answers else None, rounds
        )
    )


@github_app.command("audit")
def github_audit(output: Path = Path("reports/github-audit.json")) -> None:
    from teor.github import audit

    write_json(output, audit())


@github_app.command("apply")
def github_apply(output: Path = Path("reports/github-apply.json")) -> None:
    from teor.github import apply

    write_json(output, apply())
    typer.echo(f"Relatório em {output}")


@calibration_app.command("run")
def calibration_run(
    items: Path, config: Path, prices: Path, output: Path = Path("private/calibration")
) -> None:
    from teor.calibration import run_suite

    asyncio.run(run_suite(load_items(items), read_json(config), prices, output))


@calibration_app.command("report")
def calibration_report(items: Path, answers: list[Path], output: Path) -> None:
    from teor.calibration import recalibrate

    typer.echo(
        recalibrate(load_items(items), [p for path in answers for p in predictions(path)], output)
    )


if __name__ == "__main__":
    app()
