"""Lotes têm uma identidade local persistente; a ordem de retorno nunca identifica uma previsão."""

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from teor.io import digest, read_json, read_jsonl, write_json, write_jsonl
from teor.models import Item, Prediction
from teor.runner import SYSTEM, request_prompt, reserve_cost
from teor.scoring import parse_response

PROVIDERS = {"openai", "anthropic", "gemini", "vertex", "bedrock", "azure"}


def prepare(
    items: list[Item],
    provider: str,
    model: str,
    output: Path,
    config: dict[str, Any],
    price: dict[str, Any],
    budget: float,
    max_output: int = 1024,
) -> dict[str, Any]:
    if provider not in PROVIDERS:
        raise ValueError("Provedor batch desconhecido")
    if any(i.track == "G" for i in items):
        raise ValueError("G exige execução interativa síncrona")
    # A capacidade é explícita e datada; famílias de modelos não implicam suporte a batch.
    capabilities = config.get("capabilities", {})
    if (
        capabilities.get("model") != model
        or not capabilities.get("batch")
        or not capabilities.get("as_of")
    ):
        raise ValueError("Informe a capacidade batch verificada para o modelo")
    if provider in ("vertex", "bedrock", "azure"):
        if not config.get("region") or capabilities.get("region") != config["region"]:
            raise ValueError("Capacidade deve corresponder à região configurada")
    required = {
        "vertex": ["project"]
        + ([] if config.get("bigquery_input") and config.get("bigquery_output") else ["bucket"]),
        "bedrock": ["bucket", "role_arn"],
        "azure": ["endpoint"],
    }.get(provider, [])
    if any(not config.get(key) for key in required):
        raise ValueError(f"Recursos batch obrigatórios: {', '.join(required)}")
    count = sum(len(i.prompts) for i in items)
    reserve = reserve_cost(count, price, max_output)
    if reserve > budget:
        raise ValueError("Lote excede reserva de orçamento")
    run_id = digest(
        {
            "items": digest(items),
            "provider": provider,
            "model": model,
            "config": config,
            "max_output": max_output,
            "price": price,
        }
    )[:24]
    if (output / "job.json").exists():
        previous = read_json(output / "job.json")
        if previous["id"] != run_id:
            raise ValueError("Destino pertence a outro lote")
        return previous
    rows: list[dict[str, Any]] = []
    mapping: dict[str, Any] = {}
    request: dict[str, Any]
    for item in items:
        for variant in range(len(item.prompts)):
            # O mesmo item em outro job não pode aceitar uma resposta de uma execução anterior.
            key = digest({"run_id": run_id, "item": item.id, "variant": variant})[:32]
            prompt = request_prompt(item, variant)
            if len((SYSTEM + prompt).encode()) + 512 > price["max_input_tokens"]:
                raise ValueError("Entrada excede limite conservador configurado")
            mapping[key] = {"item_id": item.id, "variant": variant}
            messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
            if provider in ("openai", "azure"):
                rows.append(
                    {
                        "custom_id": key,
                        "method": "POST",
                        "url": "/v1/chat/completions",
                        "body": {
                            "model": model,
                            "messages": messages,
                            "max_completion_tokens": max_output,
                            **(
                                {"temperature": 0}
                                if price.get("supports_temperature", True)
                                else {}
                            ),
                        },
                    }
                )
            elif provider == "anthropic":
                rows.append(
                    {
                        "custom_id": key,
                        "params": {
                            "model": model,
                            "max_tokens": max_output,
                            "system": SYSTEM,
                            "messages": messages[1:],
                            **(
                                {"temperature": 0}
                                if price.get("supports_temperature", True)
                                else {}
                            ),
                        },
                    }
                )
            elif provider in ("gemini", "vertex") and config.get("family", "gemini") == "gemini":
                request = {
                    "contents": [{"role": "user", "parts": [{"text": SYSTEM + "\n" + prompt}]}],
                    "generationConfig": {
                        "maxOutputTokens": max_output,
                        **({"temperature": 0} if price.get("supports_temperature", True) else {}),
                    },
                }
                rows.append(
                    {"key": key, "request": request}
                    if provider == "gemini"
                    else {"request": request}
                )
                # Vertex repete o request no retorno; não dependemos de índice de linha.
                mapping[digest(request)] = mapping[key]
            elif provider == "vertex" and config.get("family") == "claude":
                request = {
                    "anthropic_version": "vertex-2023-10-16",
                    "max_tokens": max_output,
                    "system": SYSTEM,
                    "messages": messages[1:],
                }
                rows.append({"request": request})
                mapping[digest(request)] = mapping[key]
            elif provider == "bedrock":
                rows.append(
                    {
                        "recordId": key,
                        "modelInput": {
                            "system": [{"text": SYSTEM}],
                            "messages": [{"role": "user", "content": [{"text": prompt}]}],
                            "inferenceConfig": {
                                "maxTokens": max_output,
                                **(
                                    {"temperature": 0}
                                    if price.get("supports_temperature", True)
                                    else {}
                                ),
                            },
                        },
                    }
                )
            else:
                raise ValueError("Família batch não suportada por este adaptador")
    job = {
        "id": run_id,
        "provider": provider,
        "model": model,
        "config": config,
        "price": price,
        "reserved_usd": reserve,
        "budget_usd": budget,
        "expected": count,
        "mapping": mapping,
        "state": "prepared",
        "remote_id": None,
        "created_at": datetime.now(UTC).isoformat(),
    }
    write_jsonl(output / "requests.jsonl", rows)
    write_json(output / "job.json", job)
    return job


class BatchAdapter:
    def __init__(self, root: Path):
        self.root, self.job = root, read_json(root / "job.json")
        self.provider, self.config = self.job["provider"], self.job["config"]

    def save(self) -> dict[str, Any]:
        write_json(self.root / "job.json", self.job)
        return self.job

    def openai_client(self) -> Any:
        from openai import OpenAI

        if self.provider == "azure":
            from azure.identity import DefaultAzureCredential, get_bearer_token_provider

            token = get_bearer_token_provider(
                DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
            )
            return OpenAI(
                base_url=self.config["endpoint"].rstrip("/") + "/openai/v1/",
                api_key=os.environ.get("AZURE_OPENAI_API_KEY") or token,
            )
        return OpenAI()

    def google_client(self) -> Any:
        from google import genai

        return genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    def aws(self) -> tuple[Any, Any]:
        import boto3

        return boto3.client("bedrock", region_name=self.config["region"]), boto3.client(
            "s3", region_name=self.config["region"]
        )

    def vertex_client(self) -> Any:
        from google.cloud import aiplatform

        return aiplatform.gapic.JobServiceClient(
            client_options={"api_endpoint": f"{self.config['region']}-aiplatform.googleapis.com"}
        )

    def submit(self) -> dict[str, Any]:
        if self.job["remote_id"]:
            return self.status()
        if self.job["state"] == "submitting":
            raise ValueError("Submissão interrompida: reconcilie o ID remoto antes de reenviar")
        self.job["state"] = "submitting"
        self.save()
        provider = self.provider
        if provider in ("openai", "azure"):
            client = self.openai_client()
            with (self.root / "requests.jsonl").open("rb") as stream:
                file = client.files.create(file=stream, purpose="batch")
            remote = client.batches.create(
                input_file_id=file.id,
                endpoint="/v1/chat/completions",
                completion_window="24h",
                metadata={"teor_run": self.job["id"]},
                extra_headers={"Idempotency-Key": self.job["id"]},
            )
            self.job["remote_id"] = remote.id
        elif provider == "anthropic":
            from anthropic import Anthropic

            remote = Anthropic().messages.batches.create(
                requests=read_jsonl(self.root / "requests.jsonl"),
                extra_headers={"Idempotency-Key": self.job["id"]},
            )
            self.job["remote_id"] = remote.id
        elif provider == "gemini":
            client = self.google_client()
            source = client.files.upload(
                file=str(self.root / "requests.jsonl"), config={"mime_type": "application/jsonl"}
            )
            remote = client.batches.create(
                model=self.job["model"], src=source.name, config={"display_name": self.job["id"]}
            )
            self.job["remote_id"] = remote.name
        elif provider == "bedrock":
            bedrock, s3 = self.aws()
            bucket, prefix = self.config["bucket"], self.config.get("prefix", "teor")
            key = f"{prefix}/{self.job['id']}/input.jsonl"
            s3.upload_file(str(self.root / "requests.jsonl"), bucket, key)
            remote = bedrock.create_model_invocation_job(
                jobName=self.job["id"],
                clientRequestToken=self.job["id"],
                roleArn=self.config["role_arn"],
                modelId=self.job["model"],
                modelInvocationType="Converse",
                inputDataConfig={"s3InputDataConfig": {"s3Uri": f"s3://{bucket}/{key}"}},
                outputDataConfig={
                    "s3OutputDataConfig": {
                        "s3Uri": f"s3://{bucket}/{prefix}/{self.job['id']}/output/"
                    }
                },
            )
            self.job["remote_id"] = remote["jobArn"]
        elif provider == "vertex":
            import google.cloud.storage as storage
            from google.cloud.aiplatform_v1.types import BatchPredictionJob

            project, region = self.config["project"], self.config["region"]
            bucket, prefix = self.config.get("bucket", ""), self.config.get("prefix", "teor")
            key = f"{prefix}/{self.job['id']}/input.jsonl"
            if not self.config.get("bigquery_input"):
                storage.Client(project=project).bucket(bucket).blob(key).upload_from_filename(
                    str(self.root / "requests.jsonl")
                )
            job = BatchPredictionJob(
                display_name=self.job["id"],
                model=self.job["model"],
                input_config={
                    "instances_format": "jsonl",
                    "gcs_source": {"uris": [f"gs://{bucket}/{key}"]},
                },
                output_config={
                    "predictions_format": "jsonl",
                    "gcs_destination": {
                        "output_uri_prefix": f"gs://{bucket}/{prefix}/{self.job['id']}/output/"
                    },
                },
            )
            if self.config.get("bigquery_input"):
                from google.cloud import bigquery

                table = self.config["bigquery_input"].removeprefix("bq://")
                actual = [
                    dict(row.items()) for row in bigquery.Client(project=project).list_rows(table)
                ]
                requests = read_jsonl(self.root / "requests.jsonl")
                fingerprints = sorted(
                    digest(
                        json.loads(row["request"])
                        if isinstance(row["request"], str)
                        else row["request"]
                    )
                    for row in actual
                )
                if fingerprints != sorted(digest(row["request"]) for row in requests):
                    raise ValueError("Tabela BigQuery não corresponde aos requests preparados")
                job.input_config = BatchPredictionJob.InputConfig(
                    {
                        "instances_format": "bigquery",
                        "bigquery_source": {"input_uri": self.config["bigquery_input"]},
                    }
                )
            if self.config.get("bigquery_output"):
                job.output_config = BatchPredictionJob.OutputConfig(
                    {
                        "predictions_format": "bigquery",
                        "bigquery_destination": {"output_uri": self.config["bigquery_output"]},
                    }
                )
            remote = self.vertex_client().create_batch_prediction_job(
                parent=f"projects/{project}/locations/{region}", batch_prediction_job=job
            )
            self.job["remote_id"] = remote.name
        self.job["state"] = "submitted"
        return self.save()

    def status(self) -> dict[str, Any]:
        remote_id = self.job["remote_id"]
        if not remote_id:
            return self.job
        if self.provider in ("openai", "azure"):
            data = self.openai_client().batches.retrieve(remote_id).model_dump(mode="json")
            state = data["status"]
        elif self.provider == "anthropic":
            from anthropic import Anthropic

            data = Anthropic().messages.batches.retrieve(remote_id).model_dump(mode="json")
            state = data["processing_status"]
        elif self.provider == "gemini":
            data = self.google_client().batches.get(name=remote_id).model_dump(mode="json")
            state = data["state"]
        elif self.provider == "bedrock":
            data = self.aws()[0].get_model_invocation_job(jobIdentifier=remote_id)
            state = data["status"]
        else:
            remote = self.vertex_client().get_batch_prediction_job(name=remote_id)
            from google.protobuf.json_format import MessageToDict

            data = MessageToDict(remote._pb, preserving_proto_field_name=True)
            state = str(remote.state)
        self.job["state"] = str(state)
        # Nenhum SDK pode colocar credenciais em logs; só guardamos campos necessários.
        self.job["remote"] = {
            k: v
            for k, v in data.items()
            if k
            in (
                "status",
                "state",
                "output_file_id",
                "error_file_id",
                "dest",
                "outputDataConfig",
                "output_info",
                "request_counts",
                "requestCounts",
            )
        }
        return self.save()

    def cancel(self) -> dict[str, Any]:
        remote_id = self.job["remote_id"]
        if not remote_id:
            raise ValueError("Lote ainda não foi submetido")
        if self.provider in ("openai", "azure"):
            self.openai_client().batches.cancel(remote_id)
        elif self.provider == "anthropic":
            from anthropic import Anthropic

            Anthropic().messages.batches.cancel(remote_id)
        elif self.provider == "gemini":
            self.google_client().batches.cancel(name=remote_id)
        elif self.provider == "bedrock":
            self.aws()[0].stop_model_invocation_job(jobIdentifier=remote_id)
        else:
            self.vertex_client().cancel_batch_prediction_job(name=remote_id)
        self.job["state"] = "cancelling"
        return self.save()

    def download(self) -> Path:
        self.status()
        destination = self.root / "responses.jsonl"
        remote = self.job.get("remote", {})
        if self.provider in ("openai", "azure"):
            client = self.openai_client()
            chunks = [
                client.files.content(remote[k]).content
                for k in ("output_file_id", "error_file_id")
                if remote.get(k)
            ]
            if not chunks:
                raise ValueError("Lote ainda não tem arquivos de saída")
            destination.write_bytes(b"\n".join(chunks))
        elif self.provider == "anthropic":
            from anthropic import Anthropic

            write_jsonl(
                destination,
                [
                    r.model_dump(mode="json")
                    for r in Anthropic().messages.batches.results(self.job["remote_id"])
                ],
            )
        elif self.provider == "gemini":
            file = remote.get("dest", {}).get("file_name")
            if not file:
                raise ValueError("Lote ainda não tem arquivo de saída")
            destination.write_bytes(self.google_client().files.download(file=file))
        elif self.provider == "bedrock":
            _, s3 = self.aws()
            bucket, prefix = self.config["bucket"], self.config.get("prefix", "teor")
            chunks = []
            for page in s3.get_paginator("list_objects_v2").paginate(
                Bucket=bucket, Prefix=f"{prefix}/{self.job['id']}/output/"
            ):
                for obj in page.get("Contents", []):
                    if obj["Key"].endswith(".jsonl.out"):
                        chunks.append(s3.get_object(Bucket=bucket, Key=obj["Key"])["Body"].read())
            destination.write_bytes(b"\n".join(chunks))
        elif self.config.get("bigquery_output"):
            from google.cloud import bigquery

            table = remote.get("output_info", {}).get("bigquery_output_table")
            if not table:
                raise ValueError("Tabela de saída ainda não disponível")
            write_jsonl(
                destination,
                [
                    dict(r.items())
                    for r in bigquery.Client(project=self.config["project"]).list_rows(table)
                ],
            )
        else:
            import google.cloud.storage as storage

            chunks = []
            for blob in storage.Client(project=self.config["project"]).list_blobs(
                self.config["bucket"],
                prefix=f"{self.config.get('prefix', 'teor')}/{self.job['id']}/output/",
            ):
                if blob.name.endswith(".jsonl"):
                    chunks.append(blob.download_as_bytes())
            destination.write_bytes(b"\n".join(chunks))
        if not destination.exists() or not destination.stat().st_size:
            raise ValueError("Lote ainda não tem saída disponível; consulte o estado remoto")
        return destination


def import_responses(root: Path, source: Path, output: Path) -> list[Prediction]:
    job = read_json(root / "job.json")
    predictions: dict[tuple[str, int], Prediction] = {}
    if output.exists():
        for row in read_jsonl(output):
            pred = Prediction.model_validate(row)
            if pred.run_id != job["id"]:
                raise ValueError("Checkpoint de outro lote")
            predictions[(pred.item_id, pred.variant)] = pred
    for row in read_jsonl(source):
        key = row.get("custom_id", row.get("key", row.get("recordId")))
        if not key and "request" in row:
            request = row["request"]
            if isinstance(request, str):
                request = json.loads(request)
            key = digest(request)
        if key not in job["mapping"]:
            raise ValueError("Resposta sem identidade reconhecida; não inferimos pela posição")
        identity = job["mapping"][key]
        body = row.get("response", row.get("modelOutput", row.get("result", {}))) or {}
        if isinstance(body, str):
            body = json.loads(body)
        error = row.get("error") or body.get("error")
        if body.get("status_code", 200) >= 400:
            error = error or {"code": body["status_code"]}
        if body.get("type") in ("expired", "canceled", "errored"):
            error = error or {"code": body["type"]}
        body = body.get("body", body.get("message", body))
        if body.get("choices"):
            text = body["choices"][0]["message"].get("content", "")
        elif "content" in body:
            text = "".join(c.get("text", "") for c in body["content"])
        elif body.get("candidates"):
            text = "".join(
                p.get("text", "") for p in body["candidates"][0].get("content", {}).get("parts", [])
            )
        elif "output" in body:
            text = "".join(
                c.get("text", "") for c in body["output"].get("message", {}).get("content", [])
            )
        else:
            text = ""
        value, abstain, status = parse_response(text)
        if error or row.get("status") and not text:
            status = "infrastructure_error"
        usage = body.get("usage", body.get("usageMetadata", {}))
        inputs = usage.get(
            "input_tokens",
            usage.get("prompt_tokens", usage.get("inputTokens", usage.get("promptTokenCount", 0))),
        )
        outputs = usage.get(
            "output_tokens",
            usage.get(
                "completion_tokens", usage.get("outputTokens", usage.get("candidatesTokenCount", 0))
            ),
        )
        pred = Prediction(
            **identity,
            run_id=job["id"],
            model=job["model"],
            response=value,
            abstain=abstain,
            status=status,
            input_tokens=inputs,
            output_tokens=outputs,
            cost_usd=(
                inputs * job["price"]["input_per_million"]
                + outputs * job["price"]["output_per_million"]
            )
            / 1_000_000
            if usage
            else None,
            error=str(error) if error else None,
        )
        previous = predictions.get((pred.item_id, pred.variant))
        if previous and previous.status != "infrastructure_error" and previous != pred:
            raise ValueError("Resposta divergente para identidade já importada")
        predictions[(pred.item_id, pred.variant)] = pred
    results = sorted(predictions.values(), key=lambda p: (p.item_id, p.variant))
    write_jsonl(output, results)
    return results
