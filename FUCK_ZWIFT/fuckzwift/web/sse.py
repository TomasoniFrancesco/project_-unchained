"""SSE — Server-Sent Events stream."""

from __future__ import annotations

import json
import time

from flask import Blueprint, Response

from fuckzwift.state import state

sse_bp = Blueprint("sse", __name__)


@sse_bp.route("/events")
def events():
    def generate():
        while True:
            yield f"data: {json.dumps(state)}\n\n"
            time.sleep(0.5)
    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
