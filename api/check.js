export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const username = String(req.query?.username || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return res.status(400).json({
      ok: false,
      code: "INVALID",
      message: "Invalid Instagram username."
    });
  }

  // Cache successful lookups for 60 seconds inside a warm serverless instance.
  globalThis.__igCache ??= new Map();
  const cached = globalThis.__igCache.get(username);
  if (cached && Date.now() - cached.time < 60000) {
    return res.status(200).json(cached.data);
  }

  const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;

  function makeHeaders() {
    return {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/153.0.0.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache"
    };
  }

  function meta(html, key) {
    const a = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ).exec(html);
    if (a?.[1]) return a[1];

    const b = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      "i"
    ).exec(html);
    return b?.[1] || "";
  }

  function unescapeHtml(s) {
    return s
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/gi, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function parseCount(text, label) {
    const m = new RegExp(
      `([\\d,.]+[KkMm]?)\\s+${label}`,
      "i"
    ).exec(text || "");
    return m ? m[1] : null;
  }

  function looksNotFound(html) {
    const t = html.toLowerCase();
    return (
      t.includes("sorry, this page isn't available") ||
      t.includes("page not found") ||
      t.includes("the link you followed may be broken")
    );
  }

  // 1) Public HTML page. This is the least dependent on Instagram's private web API.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);

    const page = await fetch(profileUrl, {
      method: "GET",
      headers: makeHeaders(),
      redirect: "follow",
      signal: controller.signal
    });

    clearTimeout(timer);

    const html = await page.text();
    const ogTitle = unescapeHtml(meta(html, "og:title"));
    const ogImage = unescapeHtml(meta(html, "og:image"));
    const ogDescription = unescapeHtml(meta(html, "og:description"));

    if (page.status === 404 || (looksNotFound(html) && !ogTitle && !ogImage)) {
      const data = { ok: true, exists: false };
      globalThis.__igCache.set(username, { time: Date.now(), data });
      return res.status(200).json(data);
    }

    // Common public metadata on Instagram pages.
    const exactUser = new RegExp(
      `"username"\\s*:\\s*"${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
      "i"
    ).test(html);

    if (page.ok && (exactUser || ogImage || ogTitle)) {
      const data = {
        ok: true,
        exists: true,
        username,
        full_name: ogTitle
          ? ogTitle.replace(/\s*\(@[^)]+\)\s*$/, "").trim()
          : "",
        profile_pic_url: ogImage || null,
        followers_count: parseCount(ogDescription, "Followers"),
        following_count: parseCount(ogDescription, "Following"),
        posts_count:
          parseCount(ogDescription, "Posts") ||
          parseCount(ogDescription, "post"),
        biography: "",
        is_private: /private account/i.test(html)
      };

      globalThis.__igCache.set(username, { time: Date.now(), data });
      return res.status(200).json(data);
    }
  } catch (_) {
    // Continue to fallback.
  }

  // 2) Instagram web_profile_info fallback.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);

    const apiUrl =
      "https://www.instagram.com/api/v1/users/web_profile_info/?username=" +
      encodeURIComponent(username);

    const upstream = await fetch(apiUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": profileUrl,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/153.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*"
      }
    });

    clearTimeout(timer);

    if (upstream.status === 404) {
      const data = { ok: true, exists: false };
      globalThis.__igCache.set(username, { time: Date.now(), data });
      return res.status(200).json(data);
    }

    if (upstream.status === 429) {
      return res.status(429).json({
        ok: false,
        code: "RATE_LIMIT",
        message:
          "Instagram so‘rovlarni vaqtincha chekladi (429). " +
          "Bir necha daqiqadan keyin qayta urinib ko‘ring."
      });
    }

    if (upstream.status === 403) {
      return res.status(429).json({
        ok: false,
        code: "RATE_LIMIT",
        message:
          "Instagram avtomatik tekshiruvni chekladi. Keyinroq qayta urinib ko‘ring."
      });
    }

    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !type.includes("json")) {
      return res.status(502).json({
        ok: false,
        code: "UPSTREAM",
        message: "Instagram profil ma’lumotini qaytarmadi."
      });
    }

    const json = await upstream.json();
    const user = json?.data?.user;

    if (!user) {
      return res.status(200).json({ ok: true, exists: false });
    }

    const data = {
      ok: true,
      exists: true,
      username: user.username || username,
      full_name: user.full_name || "",
      biography: user.biography || "",
      profile_pic_url:
        user.profile_pic_url_hd || user.profile_pic_url || null,
      followers_count: user.edge_followed_by?.count ?? null,
      following_count: user.edge_follow?.count ?? null,
      posts_count: user.edge_owner_to_timeline_media?.count ?? null,
      is_private: Boolean(user.is_private),
      is_verified: Boolean(user.is_verified)
    };

    globalThis.__igCache.set(username, { time: Date.now(), data });
    return res.status(200).json(data);
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({
        ok: false,
        code: "TIMEOUT",
        message: "Instagram serveriga ulanish vaqti tugadi."
      });
    }

    return res.status(502).json({
      ok: false,
      code: "FETCH_ERROR",
      message: "Instagram serveriga ulanishda xatolik yuz berdi."
    });
  }
}
