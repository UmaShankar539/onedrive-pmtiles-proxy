
const http = require("http");
const { Readable } = require("stream");

const PORT = process.env.PORT || 3000;
const FILE_URL = process.env.ONEDRIVE_FILE_URL;
const ALLOWED_ORIGIN = "https://umashankar539.github.io";

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  if (origin && origin !== ALLOWED_ORIGIN) {
    res.writeHead(403);
    return res.end("Origin not allowed");
  }

  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Range, Content-Length, Content-Type"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("Proxy is running");
  }

  if (!FILE_URL) {
    res.writeHead(500);
    return res.end("Missing ONEDRIVE_FILE_URL");
  }

  if (req.url === "/test") {
    try {
      const upstream = await fetch(FILE_URL, {
        headers: { Range: "bytes=0-126" },
        redirect: "follow"
      });

      if (upstream.status !== 206 || !upstream.body) {
        await upstream.body?.cancel();
        res.writeHead(502);
        return res.end("RANGE TEST FAILED: OneDrive did not return HTTP 206");
      }

      const contentRange = upstream.headers.get("content-range") || "";

      if (!contentRange.startsWith("bytes 0-126/")) {
        await upstream.body.cancel();
        res.writeHead(502);
        return res.end("RANGE TEST FAILED: Unexpected Content-Range");
      }

      const reader = upstream.body.getReader();
      let total = 0;

      while (total < 127) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
      }

      await reader.cancel();

      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(
        "Upstream status: 206" +
        "\nDownloaded bytes: " + total +
        "\nContent-Range: " + contentRange +
        "\n\n" + (total === 127 ? "RANGE TEST SUCCESS" : "RANGE TEST FAILED")
      );
    } catch (error) {
      res.writeHead(502);
      return res.end("Test failed: " + error.message);
    }
  }

  if (req.url !== "/file" || req.method !== "GET") {
    res.writeHead(404);
    return res.end("Not found");
  }

  const range = req.headers.range;

  if (!range || !/^bytes=\d+-\d*$/.test(range)) {
    res.writeHead(400);
    return res.end("A single byte Range header is required");
  }

  try {
    const upstream = await fetch(FILE_URL, {
      headers: { Range: range },
      redirect: "follow"
    });

    if (upstream.status !== 206 || !upstream.body) {
      await upstream.body?.cancel();
      res.writeHead(502);
      return res.end("OneDrive did not return HTTP 206 Partial Content");
    }

    const contentRange = upstream.headers.get("content-range");

    if (!contentRange || !contentRange.startsWith("bytes ")) {
      await upstream.body.cancel();
      res.writeHead(502);
      return res.end("OneDrive returned an invalid Content-Range");
    }

    const headers = {
      "Content-Type": "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Content-Range": contentRange,
      "Cache-Control": "public, max-age=3600"
    };

    const length = upstream.headers.get("content-length");
    if (length) headers["Content-Length"] = length;

    res.writeHead(206, headers);
    Readable.fromWeb(upstream.body).pipe(res);

  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Proxy error: " + error.message);
    } else {
      res.destroy(error);
    }
  }
});

server.listen(PORT, () => {
  console.log("PMTiles proxy running on port " + PORT);
});
