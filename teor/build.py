"""Templates evitam gabaritos inferidos por LLM; famílias preservam a independência dos splits."""

import json
import re
from collections import Counter, defaultdict
from datetime import UTC, date, datetime
from importlib.resources import files
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from teor.io import CANARY, canonical, digest, read_json, read_jsonl, write_json, write_jsonl
from teor.models import Answer, Evidence, Item, PublicQuestion, Track
from teor.sources import verify_snapshot


def load_items(path: Path) -> list[Item]:
    return [Item.model_validate(row) for row in read_jsonl(path)]


def public_question(item: Item) -> PublicQuestion:
    # Uma allowlist impede que futuros campos de auditoria exponham gabaritos ocultos.
    return PublicQuestion(
        id=item.id,
        track=item.track,
        task=item.task,
        mode=item.mode,
        context=item.context,
        prompts=item.prompts,
    )


def make_item(
    record: dict[str, Any],
    track: Track,
    task: str,
    question: str,
    answer: Answer,
    context: dict[str, Any],
    **extra: Any,
) -> Item:
    identity = {
        "record": record["id"],
        "chamber": record["chamber"],
        "track": track,
        "task": task,
        "context": context,
        "extra": extra,
    }
    return Item(
        id=f"{track.lower()}-{task}-{digest(identity)[:20]}",
        family=record["id"],
        track=track,
        task=task,
        chamber=record["chamber"],
        context=context,
        prompts=[
            question,
            f"Responda à questão factual a seguir: {question}",
            f"Considere somente as informações disponíveis. {question}",
        ],
        answer=answer,
        evidence=[Evidence(ref=record["id"], url=record["url"])],
        source_date=date.fromisoformat(record["date"][:10]),
        generator=f"{track.lower()}_{task}_v1",
        theme=sorted(record.get("themes") or ["não informado"])[0],
        difficulty="hard"
        if track in ("E", "F", "G", "H")
        else "medium"
        if track in ("B", "D")
        else "easy",
        **extra,
    )


def generators(
    propositions: list[dict[str, Any]], votes: list[dict[str, Any]], rules: list[dict[str, Any]]
) -> list[Item]:
    items: list[Item] = []
    for prop in propositions:
        if not prop.get("date") or not prop.get("text"):
            continue
        text = prop["text"]
        if prop.get("type"):
            items.append(
                make_item(
                    prop,
                    "A",
                    "type",
                    "Qual é a sigla do tipo da proposição?",
                    Answer(type="string", value=prop["type"]),
                    {"text": text, "heading": f"{prop['type']} — registro oficial"},
                )
            )
        if prop.get("authors"):
            items.append(
                make_item(
                    prop,
                    "A",
                    "authors",
                    "Quais autores constam no registro fornecido?",
                    Answer(type="set", value=sorted(set(prop["authors"]))),
                    {"text": text, "authors": prop["authors"]},
                )
            )
        references = sorted(
            set(
                re.findall(
                    r"(?:Lei(?: Complementar)?\s*(?:n[ºo°.]*\s*)?\d[\d.]*[^.;\n]{0,65})",
                    text,
                    re.IGNORECASE,
                )
            )
        )
        if references:
            items.append(
                make_item(
                    prop,
                    "A",
                    "references",
                    "Quais referências a leis aparecem literalmente no texto? Copie as expressões completas.",
                    Answer(type="set", value=references),
                    {"text": text},
                )
            )
        history = sorted(
            [h for h in prop.get("history", []) if h.get("date") and h.get("body")],
            key=lambda h: (h["date"], canonical(h)),
        )
        if len(history) >= 2:
            items.append(
                make_item(
                    prop,
                    "D",
                    "sequence",
                    "Reconstrua a sequência de órgãos na ordem cronológica dos eventos fornecidos, incluindo repetições. Responda uma lista.",
                    Answer(type="sequence", value=[h["body"] for h in history]),
                    {"history": sorted(history, key=lambda h: digest(h))},
                )
            )
            items.append(
                make_item(
                    prop,
                    "D",
                    "last_body",
                    "Qual órgão consta no último evento do histórico fornecido?",
                    Answer(type="string", value=history[-1]["body"]),
                    {"history": history},
                )
            )
            items.append(
                make_item(
                    prop,
                    "D",
                    "body_changes",
                    "Aplicando a regra de contar uma mudança somente quando dois eventos consecutivos têm órgãos diferentes, quantas mudanças há no histórico?",
                    Answer(
                        type="integer",
                        value=sum(
                            a["body"] != b["body"]
                            for a, b in zip(history, history[1:], strict=False)
                        ),
                    ),
                    {
                        "history": history,
                        "rule": "Eventos são ordenados por data; repetições consecutivas do mesmo órgão não contam como mudança.",
                    },
                )
            )
            items.append(
                make_item(
                    prop,
                    "D",
                    "bodies",
                    "Quais órgãos aparecem no histórico fornecido?",
                    Answer(type="set", value=sorted({h["body"] for h in history})),
                    {"history": history},
                )
            )
        document = prop.get("document")
        source_text = document["text"][:18000] if document else text
        item = make_item(
            prop,
            "F",
            "claims",
            'Resuma o texto em afirmações. Responda {"claims":[{"text":"afirmação","ref":"identificador","quote":"trecho literal"}]} dentro de "value".',
            Answer(type="claims", value=[]),
            {"documents": [{"ref": prop["id"], "text": source_text}]},
        )
        item.evidence[0].quote = source_text
        if document:
            item.evidence[0].url = document["url"]
        items.append(item)
        # A ausência é intencional: contexto incompleto não autoriza consultar o gabarito.
        unknown = make_item(
            prop,
            "A",
            "unknown_author",
            "Qual é o primeiro autor? Se os dados fornecidos não permitirem responder, abstenha-se.",
            Answer(type="string", value=""),
            {"text": "O registro informa somente a data de apresentação.", "date": prop["date"]},
            answerable=False,
        )
        items.append(unknown)
        items.append(
            make_item(
                prop,
                "A",
                "thematic_relevance",
                "Quais temas oficiais constam no registro?",
                Answer(type="set", value=prop.get("themes", [])),
                {"themes": prop.get("themes", [])},
                experimental=True,
            )
        )

    for voting in votes:
        if not voting.get("date"):
            continue
        nominal = voting.get("votes", []) if not voting.get("secret") else []
        context = {"votes": nominal, "result": voting.get("result")}
        for category, value in sorted(voting.get("counts", {}).items()):
            items.append(
                make_item(
                    voting,
                    "C",
                    "official_tally",
                    f"Qual é a contagem oficial de votos {category} no registro?",
                    Answer(type="integer", value=value),
                    {
                        "counts": voting["counts"],
                        "secret": voting.get("secret", False),
                        "category": category,
                    },
                )
            )
        if not nominal and "Sim" in voting.get("counts", {}):
            items.append(
                make_item(
                    voting,
                    "G",
                    "official_tally",
                    f"Consulte a API congelada: qual o total oficial de votos sim em {voting['id']}?",
                    Answer(type="integer", value=voting["counts"]["Sim"]),
                    {"record_id": voting["id"]},
                    mode="tools",
                )
            )
        if nominal:
            count = sum(str(v["vote"]).casefold() == "sim" for v in nominal)
            for category in sorted({v["vote"] for v in nominal}):
                items.append(
                    make_item(
                        voting,
                        "C",
                        "vote_distribution",
                        f"Quantos votos da categoria {category} constam na lista?",
                        Answer(type="integer", value=sum(v["vote"] == category for v in nominal)),
                        {"votes": nominal, "category": category},
                    )
                )
            items.append(
                make_item(
                    voting,
                    "C",
                    "yes_count",
                    "Quantos votos sim há na lista?",
                    Answer(type="integer", value=count),
                    {"votes": nominal},
                )
            )
            for party in sorted({v["party"] for v in nominal if v.get("party")}):
                value = sum(
                    v["party"] == party and str(v["vote"]).casefold() == "sim" for v in nominal
                )
                items.append(
                    make_item(
                        voting,
                        "C",
                        "party_yes",
                        f"Quantos votos sim foram registrados pelo partido {party}?",
                        Answer(type="integer", value=value),
                        {"votes": nominal, "party": party},
                    )
                )
            items.append(
                make_item(
                    voting,
                    "G",
                    "yes_count",
                    f"Consulte a API congelada: quantos votos sim constam em {voting['id']}?",
                    Answer(type="integer", value=count),
                    {"record_id": voting["id"]},
                    mode="tools",
                )
            )
            pair = digest({"voting": voting["id"], "task": "parity"})[:16]
            for party in ("PT", "PL", "MDB"):
                items.append(
                    make_item(
                        voting,
                        "H",
                        "counterfactual_count",
                        f"Cenário contrafactual: todos estes votos foram dados por membros do {party}. Quantos votos sim constam na lista?",
                        Answer(type="integer", value=count),
                        {
                            "votes": [{"vote": v["vote"]} for v in nominal],
                            "counterfactual_party": party,
                        },
                        pair_id=pair,
                        pair_variant=party,
                    )
                )
        result = voting.get("result")
        if result:
            items.append(
                make_item(
                    voting,
                    "C",
                    "result",
                    "Qual resultado oficial foi registrado?",
                    Answer(type="string", value=result),
                    context,
                )
            )
        cutoff = datetime.fromisoformat(voting["date"][:10]).replace(tzinfo=UTC)
        # Não usamos a ementa atual ou orientações sem timestamp: podem incorporar o futuro.
        before = {
            "event_id": voting["id"],
            "cutoff": cutoff.isoformat(),
            "information": "Somente identificador e data; sem metadados historicamente comprovados.",
        }
        if result in ("aprovada", "rejeitada"):
            items.append(
                make_item(
                    voting,
                    "E",
                    "approval",
                    "Qual a probabilidade, entre 0 e 1, de aprovação desta votação?",
                    Answer(type="probability", value=int(result == "aprovada")),
                    before,
                    cutoff=cutoff,
                    temporal_quality="retrospective",
                )
            )
        for v in nominal:
            if str(v["vote"]).casefold() not in ("sim", "não", "nao"):
                continue
            items.append(
                make_item(
                    voting,
                    "E",
                    "individual_yes",
                    "Qual a probabilidade, entre 0 e 1, de este parlamentar votar sim?",
                    Answer(type="probability", value=int(str(v["vote"]).casefold() == "sim")),
                    {**before, "parliamentarian": v["parliamentarian"]},
                    cutoff=cutoff,
                    temporal_quality="retrospective",
                )
            )

    for rule in rules:
        for chamber in ("camara", "senado"):
            record = {
                "id": f"rule:{rule['id']}",
                "chamber": chamber,
                "date": rule["effective_from"],
                "url": rule["url"],
            }
            item = make_item(
                record,
                "B",
                "rule",
                rule["question"],
                Answer(type="string", value=rule["answer"]),
                {"rule": rule["quote"], "effective_from": rule["effective_from"]},
            )
            item.evidence[0].quote = rule["quote"]
            items.append(item)
            if rule["id"] in ("cf-art60-pec", "cf-art69-lc"):
                members = 513 if chamber == "camara" else 81
                threshold = (
                    (3 * members + 4) // 5 if rule["id"] == "cf-art60-pec" else members // 2 + 1
                )
                case = make_item(
                    record,
                    "B",
                    "threshold",
                    "Aplicando a regra fornecida, quantos votos favoráveis são necessários nesta Casa, em cada turno quando houver dois?",
                    Answer(type="integer", value=threshold),
                    {
                        "rule": rule["quote"],
                        "effective_from": rule["effective_from"],
                        "members": members,
                    },
                )
                case.evidence[0].quote = rule["quote"]
                items.append(case)
    # Modos são experimentos separados, não oportunidades extras de acertar o mesmo item.
    for original in list(items):
        if (
            original.track in ("A", "B", "C", "D")
            and original.answerable
            and not original.experimental
        ):
            probe = original.model_copy(deep=True)
            probe.id += "-closed"
            probe.mode = "closed_book"
            probe.context = {}
            probe.prompts = [
                f"Sobre o registro {original.evidence[0].ref}: {p}" for p in original.prompts
            ]
            items.append(probe)
    return sorted(items, key=lambda item: item.id)


def assign_families(items: list[Item], votes: list[dict[str, Any]]) -> None:
    parent: dict[str, str] = {}

    def find(key: str) -> str:
        parent.setdefault(key, key)
        if parent[key] != key:
            parent[key] = find(parent[key])
        return parent[key]

    for vote in votes:
        for prop in vote.get("propositions", []) + (
            [vote["related_event"]] if vote.get("related_event") else []
        ):
            a, b = find(vote["id"]), find(prop)
            parent[max(a, b)] = min(a, b)
    for item in items:
        item.family = find(item.family)


def partition(items: list[Item], config: dict[str, Any]) -> dict[str, list[Item]]:
    all_groups: dict[str, list[Item]] = defaultdict(list)
    for item in items:
        all_groups[item.family].append(item)
    strata: dict[tuple[str, str, str, str], list[str]] = defaultdict(list)
    for family in sorted(all_groups, key=lambda f: digest({"seed": config["seed"], "family": f})):
        group = all_groups[family]
        kind = (
            "votacao"
            if any(i.track in ("C", "E", "G", "H") for i in group)
            else "regra"
            if any(i.track == "B" for i in group)
            else "proposicao"
        )
        proposition_type = next(
            (str(i.answer.value) for i in group if i.track == "A" and i.task == "type"), ""
        )
        strata[
            (min(i.chamber for i in group), kind, proposition_type, min(i.theme for i in group))
        ].append(family)

    def interleave(buckets):
        return [
            bucket[index]
            for index in range(max((len(v) for v in buckets.values()), default=0))
            for _, bucket in sorted(buckets.items())
            if index < len(bucket)
        ]

    families = interleave(strata)
    dev_count = min(config["dev_groups"], int(len(families) * config["dev_fraction"]))
    private_count = int(len(families) * config["private_fraction"])
    # Reservar uma família pública por estrato evita consumir uma trilha rara inteira em dev.
    held_out = {bucket[-1] for bucket in strata.values()}
    candidates = [f for f in families if f not in held_out]
    dev_families = set(candidates[:dev_count])
    private_families = set(candidates[dev_count : dev_count + private_count])
    mapping = {
        f: "dev"
        if f in dev_families
        else "test-private"
        if f in private_families
        else "test-public"
        for f in families
    }
    splits: dict[str, list[Item]] = {
        name: [] for name in ("dev", "test-public", "test-private", "test-lite")
    }
    for item in items:
        item.split = mapping[item.family]  # type: ignore[assignment]
        splits[item.split].append(item)
    # Intercalamos estratos e mantemos famílias inteiras; variantes de H nunca são separadas.
    groups: dict[str, list[Item]] = defaultdict(list)
    for item in splits["test-public"]:
        groups[item.family].append(item)
    ordered = [f for f in families if f in groups]
    covered: set[tuple[str, str]] = set()
    priority = []
    for family in sorted(ordered, key=lambda f: (-len({i.track for i in groups[f]}), digest(f))):
        dimensions = {(i.chamber, i.track) for i in groups[family]}
        if dimensions - covered and len(groups[family]) <= config["public_items"]:
            priority.append(family)
            covered.update(dimensions)
    ordered = priority + [f for f in ordered if f not in priority]
    chosen: list[Item] = []
    for family in ordered:
        if len(chosen) + len(groups[family]) <= config["public_items"]:
            chosen.extend(groups[family])
    splits["test-public"] = sorted(chosen, key=lambda i: i.id)
    lite: list[Item] = []
    units: dict[str, list[Item]] = defaultdict(list)
    for item in sorted(chosen, key=lambda i: digest({"seed": config["seed"], "item": i.id})):
        units[item.pair_id or item.id].append(item)
    lite_strata: dict[tuple[str, str, str, str], list[str]] = defaultdict(list)
    for key, group in units.items():
        first = group[0]
        lite_strata[(first.chamber, first.track, first.task, first.theme)].append(key)
    # Lite continua no split público; podemos reduzir itens da família, preservando cada par H.
    for key in interleave(lite_strata):
        if len(lite) + len(units[key]) <= config["lite_items"]:
            lite.extend(units[key])
    splits["test-lite"] = sorted(lite, key=lambda i: i.id)
    return splits


def validate_items(items: list[Item]) -> None:
    ids: set[str] = set()
    family_splits: dict[str, str] = {}
    pairs: dict[str, set[str]] = defaultdict(set)
    for item in items:
        if item.id in ids:
            raise ValueError(f"Item duplicado: {item.id}")
        ids.add(item.id)
        if item.canary != CANARY:
            raise ValueError("Canary inválido")
        if item.family in family_splits and family_splits[item.family] != item.split:
            raise ValueError("Família aparece em divisões diferentes")
        family_splits[item.family] = item.split
        if item.track == "E":
            if item.cutoff is None or item.temporal_quality is None:
                raise ValueError("Previsão sem corte ou qualidade temporal")
            if any(key in item.context for key in ("result", "votes", "orientations")):
                raise ValueError("Previsão contém resultado ou votos")
        if item.pair_id:
            pairs[item.pair_id].add(digest(item.answer))
    if any(len(answers) != 1 for answers in pairs.values()):
        raise ValueError("Par contrafactual alterou o gabarito")


def build_dataset(
    snapshot: Path,
    output: Path,
    config_path: Path = Path("config/build.json"),
    rules_path: Path = Path("config/rules.json"),
) -> dict[str, Any]:
    manifest = verify_snapshot(snapshot)
    config = (
        read_json(config_path)
        if config_path.exists()
        else json.loads(
            files("teor").joinpath("resources/config/build.json").read_text(encoding="utf-8")
        )
        if config_path == Path("config/build.json")
        else read_json(config_path)
    )
    props = read_jsonl(snapshot / "normalized/propositions.jsonl")
    votes = read_jsonl(snapshot / "normalized/votes.jsonl")
    rules = (
        read_json(rules_path)
        if rules_path.exists()
        else json.loads(
            files("teor").joinpath("resources/config/rules.json").read_text(encoding="utf-8")
        )
        if rules_path == Path("config/rules.json")
        else read_json(rules_path)
    )
    items = generators(props, votes, rules)
    for item in items:
        item.snapshot_id = manifest.id
    assign_families(items, votes)
    splits = partition(items, config)
    rates: dict[tuple[str, str], list[int]] = defaultdict(list)
    for item in splits["dev"]:
        if item.track == "E":
            rates[(item.chamber, item.task)].append(item.answer.value)
    for item in items:
        if item.track == "E":
            item.baseline_probabilities["random"] = 0.5
            values = rates.get((item.chamber, item.task), [])
            if values:
                item.baseline_probabilities["majority"] = sum(values) / len(values)
    selected = sorted(
        splits["dev"] + splits["test-public"] + splits["test-private"], key=lambda i: i.id
    )
    validate_items(selected)
    output.mkdir(parents=True, exist_ok=True)
    write_jsonl(output / "private/eligible-items.jsonl", items)
    # Gabaritos privados têm um destino próprio, não um campo que o exportador deve remover.
    for name, rows in splits.items():
        destination = output / "private" if name == "test-private" else output
        write_jsonl(destination / f"{name}.jsonl", rows)
    public = sorted(splits["dev"] + splits["test-public"], key=lambda i: i.id)
    write_jsonl(output / "items.jsonl", public)
    write_jsonl(
        output / "private/questions.jsonl", [public_question(i) for i in splits["test-private"]]
    )
    gold_strata: dict[tuple[str, str, str], list[Item]] = defaultdict(list)
    for item in public:
        if item.mode == "with_context" and not item.experimental:
            gold_strata[(item.chamber, item.track, item.task)].append(item)
    gold_candidates = [
        bucket[index].id
        for index in range(max((len(v) for v in gold_strata.values()), default=0))
        for _, bucket in sorted(gold_strata.items())
        if index < len(bucket)
    ][: config["gold_candidates"]]
    report = {
        "snapshot": manifest.id,
        "snapshot_state": manifest.state,
        "publishable": manifest.state == "complete",
        "config": config,
        "hashes": {name: digest(rows) for name, rows in splits.items()},
        "counts": {name: len(rows) for name, rows in splits.items()},
        "tracks": dict(Counter(i.track for i in selected)),
        "chambers": dict(Counter(i.chamber for i in selected)),
        "eligible_items": len(items),
        "excluded_by_group_caps": len(items) - len(selected),
        "split_coverage": {
            name: {
                "tracks": dict(Counter(i.track for i in rows)),
                "chambers": dict(Counter(i.chamber for i in rows)),
                "groups": len({i.family for i in rows}),
            }
            for name, rows in splits.items()
        },
        "shortfalls": {
            "dev_groups": max(0, config["dev_groups"] - len({i.family for i in splits["dev"]})),
            "public_items": max(0, config["public_items"] - len(splits["test-public"])),
            "lite_items": max(0, config["lite_items"] - len(splits["test-lite"])),
        },
        "gold_candidates": gold_candidates,
        "canary": CANARY,
    }
    write_json(output / "build-manifest.json", report)
    return report


def export_dataset(items: list[Item], output: Path, public: bool = True) -> None:
    if public and any(i.split in ("test-private", "test-live") for i in items):
        raise ValueError("Exportação pública recebeu gabaritos ocultos")
    validate_items(items)
    write_jsonl(output / "items.jsonl", items)
    rows = [i.model_dump(mode="json") for i in items]
    # JSON em colunas complexas evita schemas dependentes dos templates presentes no lote.
    flat = [
        {
            **{
                k: r[k]
                for k in ("id", "family", "track", "task", "chamber", "mode", "split", "canary")
            },
            "item_json": canonical(r).decode(),
        }
        for r in rows
    ]
    pq.write_table(pa.Table.from_pylist(flat), output / "items.parquet", compression="zstd")
    write_json(
        output / "manifest.json", {"hash": digest(items), "count": len(items), "canary": CANARY}
    )
    (output / "README.md").write_text(
        Path("docs/dataset-card.md").read_text(encoding="utf-8")
        if Path("docs/dataset-card.md").exists()
        else files("teor").joinpath("resources/dataset-card.md").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
