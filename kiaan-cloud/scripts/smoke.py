"""MCP client smoke test against the running kiaan-mcp server."""
import asyncio
import json
import os
import sys

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = os.environ.get("KIAAN_MCP_URL", "http://127.0.0.1:8000/mcp")
TOKEN = os.environ.get("KIAAN_MCP_TOKEN", "")


async def main() -> int:
    headers = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}
    async with streamablehttp_client(URL, headers=headers) as (r, w, _):
        async with ClientSession(r, w) as s:
            await s.initialize()
            names = sorted(t.name for t in (await s.list_tools()).tools if t.name.startswith("brightspace_"))
            print("brightspace tools:", ", ".join(names) or "NONE")
            ok = len(names) == 10
            for tool, args in (("brightspace_status", {}), ("brightspace_upcoming", {"days": 14})):
                res = await s.call_tool(tool, args)
                text = "".join(getattr(c, "text", "") for c in res.content)
                print(f"\n== {tool}")
                try:
                    print(json.dumps(json.loads(text), indent=1)[:4000])
                except ValueError:
                    print(text[:4000])
                ok = ok and not res.isError and '"error"' not in text
    print("\nSMOKE", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
