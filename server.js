const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const CAMERA_COUNT = 4;

const cameraSockets = new Map();
const viewersByCamera = new Map();

for (let cameraNumber = 1; cameraNumber <= CAMERA_COUNT; cameraNumber++) {
    viewersByCamera.set(cameraNumber, new Set());
}

const viewerPage = path.join(__dirname, "public", "index.html");

// Each URL serves the same viewer; the page reads its camera number from
// window.location.pathname.
app.get(/^\/camera([1-4])\/?$/, (req, res) => {
    res.sendFile(viewerPage);
});

// Keep the root useful as a small camera selector.
app.get("/", (req, res) => {
    const links = Array.from(
        { length: CAMERA_COUNT },
        (_, index) => `<li><a href="/camera${index + 1}">Camera ${index + 1}</a></li>`
    ).join("");

    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Traffic Cameras</title>
<style>body{background:#111;color:#eee;font-family:Arial;margin:40px}a{color:#00d9ff;font-size:1.4rem;line-height:2}</style>
</head><body><h1>Traffic Cameras</h1><ul>${links}</ul></body></html>`);
});

app.use(express.static(path.join(__dirname, "public")));

const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    maxPayload: 256 * 1024
});

wss.on("connection", (ws, req) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const cameraMatch = pathname.match(/^\/camera([1-4])\/?$/);
    const viewerMatch = pathname.match(/^\/viewer([1-4])\/?$/);

    if (cameraMatch) {
        const cameraNumber = Number(cameraMatch[1]);
        const previousCamera = cameraSockets.get(cameraNumber);

        if (previousCamera && previousCamera.readyState === WebSocket.OPEN) {
            previousCamera.close(1000, "Replaced by a new camera connection");
        }

        cameraSockets.set(cameraNumber, ws);
        console.log(`Camera ${cameraNumber} connected`);

        ws.on("message", (data, isBinary) => {
            if (!isBinary) return;

            const viewers = viewersByCamera.get(cameraNumber);
            for (const viewer of viewers) {
                if (viewer.readyState !== WebSocket.OPEN) continue;

                // JPEG frames are already compressed. Never queue old frames
                // for a slow viewer; object detection should receive current data.
                if (viewer.bufferedAmount === 0) {
                    viewer.send(data, { binary: true, compress: false });
                }
            }
        });

        ws.on("close", () => {
            if (cameraSockets.get(cameraNumber) === ws) {
                cameraSockets.delete(cameraNumber);
            }
            console.log(`Camera ${cameraNumber} disconnected`);
        });

        ws.on("error", (error) => {
            console.error(`Camera ${cameraNumber} error:`, error.message);
        });
        return;
    }

    if (viewerMatch) {
        const cameraNumber = Number(viewerMatch[1]);
        const viewers = viewersByCamera.get(cameraNumber);
        viewers.add(ws);
        console.log(`Camera ${cameraNumber} viewer connected (${viewers.size} total)`);

        const removeViewer = () => viewers.delete(ws);
        ws.on("close", removeViewer);
        ws.on("error", removeViewer);
        return;
    }

    console.log("Unknown WebSocket path:", pathname);
    ws.close(1008, "Unknown camera/viewer path");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Traffic camera server listening on port ${PORT}`);
    for (let cameraNumber = 1; cameraNumber <= CAMERA_COUNT; cameraNumber++) {
        console.log(`Camera ${cameraNumber}: http://localhost:${PORT}/camera${cameraNumber}`);
    }
});
