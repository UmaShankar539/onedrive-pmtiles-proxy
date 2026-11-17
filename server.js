
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

  // DIAGNOSTIC TEST
  if (req.url === "/test") {
    try {
      const upstream = await fetch(FILE_URL, {
        headers: { Range: "bytes=0-126" },
        redirect: "follow"
      });

      let preview = "";

      if (upstream.body) {
        const reader = upstream.body.getReader();
        const { value } = await reader.read();

        if (value) {
          preview = new TextDecoder().decode(
            value.slice(0, 500)
          );
        }

        await reader.cancel();
      }

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
      });

      return res.end(
        "HTTP STATUS: " + upstream.status +
        "\nFINAL URL: " + upstream.url +
        "\nCONTENT TYPE: " +
        upstream.headers.get("content-type") +
        "\nCONTENT RANGE: " +
        upstream.headers.get("content-range") +
        "\nCONTENT LENGTH: " +
        upstream.headers.get("content-length") +
        "\n\nBODY PREVIEW:\n" + preview
      );

    } catch (error) {
      res.writeHead(502);
      return res.end("Diagnostic error: " + error.message);
    }
  }

  // PMTILES RANGE REQUEST
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
      return res.end(
        "OneDrive did not return HTTP 206 Partial Content"
      );
    }

    const contentRange =
      upstream.headers.get("content-range");

    if (!contentRange || !contentRange.startsWith("bytes ")) {
      await upstream.body.cancel();

      res.writeHead(502);
      return res.end("Invalid Content-Range from OneDrive");
    }

    const headers = {
      "Content-Type": "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Content-Range": contentRange,
      "Cache-Control": "public, max-age=3600"
    };

    const length = upstream.headers.get("content-length");

    if (length) {
      headers["Content-Length"] = length;
    }

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
