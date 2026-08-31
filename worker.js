const COOKIE_NAME = "otl_session";

function loginPage(error = "") {
  return new Response(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GSH NHLS OTL Dashboard Login</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: #f5f7fb;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #1f2937;
    }

    .login-card {
      width: 360px;
      background: white;
      border-radius: 14px;
      padding: 28px;
      box-shadow: 0 2px 14px rgba(0,0,0,0.10);
    }

    h1 {
      margin-top: 0;
      font-size: 24px;
    }

    .subtitle {
      color: #6b7280;
      font-size: 14px;
      margin-bottom: 22px;
    }

    label {
      display: block;
      font-weight: 700;
      margin: 12px 0 6px;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 15px;
    }

    button {
      width: 100%;
      margin-top: 18px;
      padding: 11px;
      border: 0;
      border-radius: 8px;
      background: #2563eb;
      color: white;
      font-weight: 700;
      cursor: pointer;
    }

    .error {
      margin-top: 12px;
      color: #b91c1c;
      font-size: 14px;
    }
  </style>
</head>

<body>
  <div class="login-card">
    <h1>GSH NHLS OTL Dashboard</h1>
    <div class="subtitle">Authorised users only</div>

    <form method="POST" action="/login">
      <label>Username</label>
      <input name="username" autocomplete="username" required>

      <label>Password</label>
      <input name="password" type="password" autocomplete="current-password" required>

      <button type="submit">Log in</button>
    </form>

    ${error ? `<div class="error">${error}</div>` : ""}
  </div>
</body>
</html>
`, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function makeSession(secret) {
  const expires = Date.now() + (8 * 60 * 60 * 1000);
  const payload = String(expires);
  const signature = await hmac(secret, payload);

  return `${payload}.${signature}`;
}

async function validSession(cookieValue, secret) {
  if (!cookieValue) return false;

  const parts = cookieValue.split(".");
  if (parts.length !== 2) return false;

  const [expires, signature] = parts;

  if (!Number.isFinite(Number(expires))) return false;
  if (Date.now() > Number(expires)) return false;

  const expected = await hmac(secret, expires);

  return signature === expected;
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";

  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");

    if (key === name) {
      return value.join("=");
    }
  }

  return "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      !env.LOGIN_USERNAME ||
      !env.LOGIN_PASSWORD ||
      !env.SESSION_SECRET
    ) {
      return new Response(
        "Authentication secrets have not been configured.",
        { status: 500 }
      );
    }

    if (url.pathname === "/login" && request.method === "GET") {
      return loginPage();
    }

    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();

      const username = String(form.get("username") || "");
      const password = String(form.get("password") || "");

      if (
        username !== env.LOGIN_USERNAME ||
        password !== env.LOGIN_PASSWORD
      ) {
        return loginPage("Incorrect username or password.");
      }

      const session = await makeSession(env.SESSION_SECRET);

      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie":
            `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`
        }
      });
    }

    if (url.pathname === "/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/login",
          "Set-Cookie":
            `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
        }
      });
    }

    const sessionCookie = getCookie(request, COOKIE_NAME);

    if (!(await validSession(sessionCookie, env.SESSION_SECRET))) {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/login"
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
