import boto3
from botocore.exceptions import ClientError
from ..core.config import settings
import re


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
    )


def ensure_bucket() -> None:
    client = get_s3_client()
    try:
        existing = client.list_buckets().get("Buckets", [])
        if not any(b["Name"] == settings.s3_bucket for b in existing):
            client.create_bucket(Bucket=settings.s3_bucket)
    except ClientError as e:
        # Log and continue; bucket may already exist or we may lack perms in some envs
        print(f"[s3] ensure_bucket error: {e}")


def ensure_bucket_cors() -> None:
    client = get_s3_client()
    try:
        client.put_bucket_cors(
            Bucket=settings.s3_bucket,
            CORSConfiguration={
                "CORSRules": [
                    {
                        "AllowedHeaders": ["*"],
                        "AllowedMethods": ["PUT", "GET", "HEAD"],
                        "AllowedOrigins": ["http://localhost:3000"],
                        "ExposeHeaders": ["ETag"],
                        "MaxAgeSeconds": 3000,
                    }
                ]
            },
        )
    except ClientError as e:
        print(f"[s3] ensure_bucket_cors error: {e}")


def normalize_key_component(name: str) -> str:
    # strip directories and sanitize
    base = name.split("/")[-1].split("\\")[-1]
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    if not base:
        base = "file.bin"
    return base[:200]


def presign_put_url(object_key: str, content_type: str = "application/octet-stream", expires_in: int = 3600) -> str:
    client = get_s3_client()
    try:
        url = client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": settings.s3_bucket,
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
        )
        # Rewrite internal endpoint (e.g., http://minio:9000) to public (http://localhost:9000)
        # so the browser can PUT directly.
        if settings.s3_endpoint_url and settings.s3_public_base_url:
            url = url.replace(settings.s3_endpoint_url, settings.s3_public_base_url)
        return url
    except ClientError as e:
        print(f"[s3] presign_put_url error: {e}")
        raise


def presign_get_url(object_key: str, expires_in: int = 3600) -> str:
    client = get_s3_client()
    try:
        url = client.generate_presigned_url(
            ClientMethod="get_object",
            Params={
                "Bucket": settings.s3_bucket,
                "Key": object_key,
            },
            ExpiresIn=expires_in,
        )
        if settings.s3_endpoint_url and settings.s3_public_base_url:
            url = url.replace(settings.s3_endpoint_url, settings.s3_public_base_url)
        return url
    except ClientError as e:
        print(f"[s3] presign_get_url error: {e}")
        raise


def delete_object(object_key: str) -> None:
    client = get_s3_client()
    try:
        client.delete_object(Bucket=settings.s3_bucket, Key=object_key)
    except ClientError as e:
        print(f"[s3] delete_object error: {e}")


def delete_prefix(prefix: str) -> int:
    client = get_s3_client()
    deleted = 0
    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix=prefix):
            contents = page.get("Contents", [])
            if not contents:
                continue
            objs = [{"Key": o["Key"]} for o in contents]
            client.delete_objects(Bucket=settings.s3_bucket, Delete={"Objects": objs, "Quiet": True})
            deleted += len(objs)
    except ClientError as e:
        print(f"[s3] delete_prefix error: {e}")
    return deleted
