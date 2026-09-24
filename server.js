const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// Serve files from /public
app.use(express.static(path.join(__dirname, "public")));

let cameraSocket = null;
const viewers = new Set();

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {

    console.log("WebSocket connection:", req.url);

    // ==========================================
    // ESP32 CAMERA
    // ==========================================
    if (req.url === "/camera") {

        console.log("ESP32 camera connected");

        // Only one camera for now
        if (
            cameraSocket &&
            cameraSocket.readyState === WebSocket.OPEN
        ) {
            cameraSocket.close();
        }

        cameraSocket = ws;

        ws.on("message", (data, isBinary) => {

            if (!isBinary) {
                return;
            }

            // Forward each JPEG frame to all viewers
            for (const viewer of viewers) {

                if (viewer.readyState === WebSocket.OPEN) {

                    // Don't allow a slow viewer to build
                    // an unlimited queue in memory.
                    if (viewer.bufferedAmount < 1024 * 1024) {
                        viewer.send(data, { binary: true });
                    }
                }
            }
        });

        ws.on("close", () => {

            console.log("ESP32 camera disconnected");

            if (cameraSocket === ws) {
                cameraSocket = null;
            }
        });

        ws.on("error", (error) => {
            console.log("Camera error:", error.message);
        });

        return;
    }

    // ==========================================
    // WEB BROWSER VIEWER
    // ==========================================
    if (req.url === "/viewer") {

        viewers.add(ws);

        console.log(
            "Viewer connected. Total viewers:",
            viewers.size
        );

        ws.on("close", () => {

            viewers.delete(ws);

            console.log(
                "Viewer disconnected. Total viewers:",
                viewers.size
            );
        });

        ws.on("error", () => {
            viewers.delete(ws);
        });

        return;
    }

    // Unknown WebSocket path
    console.log("Unknown WebSocket path:", req.url);
    ws.close();
});

server.listen(PORT, "0.0.0.0", () => {

    console.log("----------------------------------");
    console.log("Traffic Camera Server");
    console.log("----------------------------------");
    console.log(`Server running on port ${PORT}`);
    console.log(`Open: http://localhost:${PORT}`);
    console.log("----------------------------------");
});