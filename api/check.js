export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const raw = String(req.query?.username || "").trim().replace(/^@+/, "").toLowerCase();

  if (!/^[a-z0-9._]{1,30}$/.test(raw)) {
    return res.status(400).json({ ok: false, message: "Invalid Instagram username." });
  }

  const url =
    "https://www.instagram.com/api/v1/users/web_profile_info/?username=" +
    encodeURIComponent(raw);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const upstream = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "X-IG-App-ID": "936619743392459",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.instagram.com/"
      }
    });

    const contentType = upstream.headers.get("content-type") || "";
    const body = await upstream.text();

    if (upstream.status === 404) {
      return res.status(200).json({ ok: true, exists: false });
    }

    if (upstream.status === 429 || upstream.status === 403) {
      return res.status(429).json({
        ok: false,
        code: "RATE_LIMIT",
        message: "Instagram avtomatik so‘rovni chekladi. Keyinroq qayta urinib ko‘ring."
      });
    }

    if (!upstream.ok || !contentType.includes("json")) {
      return res.status(502).json({
        ok: false,
        code: "UPSTREAM",
        message: "Instagram serveri JSON profil ma’lumotini qaytarmadi."
      });
    }

    let json;
    try {
      json = JSON.parse(body);
    } catch {
      return res.status(502).json({
        ok: false,
        code: "BAD_JSON",
        message: "Instagram javobini o‘qib bo‘lmadi."
      });
    }

    const user = json?.data?.user;

    if (!user) {
      return res.status(200).json({ ok: true, exists: false });
    }

    const followersCount =
      user?.edge_followed_by?.count ??
      user?.follower_count ??
      user?.followers_count ??
      null;

    const followingCount =
      user?.edge_follow?.count ??
      user?.following_count ??
      null;

    const postsCount =
      user?.edge_owner_to_timeline_media?.count ??
      user?.media_count ??
      null;

    const profilePic =
      user?.profile_pic_url_hd ||
      user?.profile_pic_url ||
      null;

    return res.status(200).json({
      ok: true,
      exists: true,
      username: user?.username || raw,
      full_name: user?.full_name || "",
      biography: user?.biography || "",
      profile_pic_url: profilePic,
      followers_count: followersCount,
      following_count: followingCount,
      posts_count: postsCount,
      is_private: Boolean(user?.is_private),
      is_verified: Boolean(user?.is_verified)
    });
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
  } finally {
    clearTimeout(timeout);
  }
}