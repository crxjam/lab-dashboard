const COOKIE_NAME = "otl_session";
const SESSION_MS = 30 * 60 * 1000;
const SESSION_MAX_AGE = 30 * 60;

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

    <div class="subtitle">
      Authorised users only
    </div>

    <form method="POST" action="/login">

      <label>Username</label>
      <input
        name="username"
        autocomplete="username"
        required
      >

      <label>Password</label>
      <input
        name="password"
        type="password"
        autocomplete="current-password"
        required
      >

      <button type="submit">
        Log in
      </button>

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
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return Array.from(
    new Uint8Array(signature)
  )
    .map(b =>
      b.toString(16).padStart(2, "0")
    )
    .join("");
}


async function makeSession(secret) {
  const expires = Date.now() + SESSION_MS;

  const payload = String(expires);

  const signature = await hmac(
    secret,
    payload
  );

  return `${payload}.${signature}`;
}


async function validSession(cookieValue, secret) {
  if (!cookieValue) return false;

  const parts = cookieValue.split(".");

  if (parts.length !== 2) return false;

  const [expires, signature] = parts;

  if (!Number.isFinite(Number(expires))) {
    return false;
  }

  if (Date.now() > Number(expires)) {
    return false;
  }

  const expected = await hmac(
    secret,
    expires
  );

  return signature === expected;
}


function getCookie(request, name) {
  const cookieHeader =
    request.headers.get("Cookie") || "";

  for (const part of cookieHeader.split(";")) {
    const [key, ...value] =
      part.trim().split("=");

    if (key === name) {
      return value.join("=");
    }
  }

  return "";
}


async function getComments(url, env) {
  const keysParam =
    url.searchParams.get("keys");

  if (!keysParam) {
    return Response.json({
      ok: true,
      comments: {}
    });
  }

  const keys = keysParam
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);

  if (!keys.length) {
    return Response.json({
      ok: true,
      comments: {}
    });
  }

  if (keys.length > 500) {
    return Response.json(
      {
        ok: false,
        error:
          "Maximum 500 sample keys per request."
      },
      {
        status: 400
      }
    );
  }

  const placeholders =
    keys.map(() => "?").join(",");

  const result = await env.DB
    .prepare(`
      SELECT
        sample_key,
        tech_status,
        comment,
        updated_by,
        updated_at
      FROM otl_comments
      WHERE sample_key IN (${placeholders})
    `)
    .bind(...keys)
    .all();

  const comments = {};

  for (const row of result.results || []) {
    comments[row.sample_key] = {
      techStatus: row.tech_status,
      comment: row.comment,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at
    };
  }

  return Response.json({
    ok: true,
    comments
  });
}


async function saveComment(request, env) {
  const body = await request.json();

  const sampleKey =
    String(body.sampleKey || "").trim();

  const techStatus =
    String(body.techStatus || "").trim();

  const comment =
    String(body.comment || "").trim();

  const updatedBy =
    String(body.updatedBy || "").trim();

  if (!sampleKey) {
    return Response.json(
      {
        ok: false,
        error: "sampleKey is required."
      },
      {
        status: 400
      }
    );
  }

  if (sampleKey.length > 128) {
    return Response.json(
      {
        ok: false,
        error: "sampleKey is too long."
      },
      {
        status: 400
      }
    );
  }

  if (techStatus.length > 100) {
    return Response.json(
      {
        ok: false,
        error: "techStatus is too long."
      },
      {
        status: 400
      }
    );
  }

  if (comment.length > 1000) {
    return Response.json(
      {
        ok: false,
        error: "Comment is too long."
      },
      {
        status: 400
      }
    );
  }

  if (updatedBy.length > 100) {
    return Response.json(
      {
        ok: false,
        error: "updatedBy is too long."
      },
      {
        status: 400
      }
    );
  }

  const updatedAt =
    new Date().toISOString();

  await env.DB
    .prepare(`
      INSERT INTO otl_comments (
        sample_key,
        tech_status,
        comment,
        updated_by,
        updated_at
      )

      VALUES (?, ?, ?, ?, ?)

      ON CONFLICT(sample_key)

      DO UPDATE SET
        tech_status = excluded.tech_status,
        comment = excluded.comment,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `)
    .bind(
      sampleKey,
      techStatus,
      comment,
      updatedBy,
      updatedAt
    )
    .run();

  return Response.json({
    ok: true,
    updatedAt
  });
}


export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);


    // -----------------------------------------
    // REQUIRED AUTHENTICATION SECRETS
    // -----------------------------------------

    if (
      !env.LOGIN_USERNAME ||
      !env.LOGIN_PASSWORD ||
      !env.SESSION_SECRET
    ) {
      return new Response(
        "Authentication secrets have not been configured.",
        {
          status: 500
        }
      );
    }


    // -----------------------------------------
    // LOGIN PAGE
    // -----------------------------------------

    if (
      url.pathname === "/login" &&
      request.method === "GET"
    ) {
      return loginPage();
    }


    // -----------------------------------------
    // LOGIN SUBMISSION
    // -----------------------------------------

    if (
      url.pathname === "/login" &&
      request.method === "POST"
    ) {

      const form =
        await request.formData();

      const username =
        String(
          form.get("username") || ""
        );

      const password =
        String(
          form.get("password") || ""
        );

      if (
        username !== env.LOGIN_USERNAME ||
        password !== env.LOGIN_PASSWORD
      ) {
        return loginPage(
          "Incorrect username or password."
        );
      }

      const session =
        await makeSession(
          env.SESSION_SECRET
        );

      return new Response(
        null,
        {
          status: 302,
          headers: {
            "Location": "/",

            "Set-Cookie":
              `${COOKIE_NAME}=${session}; ` +
              `Path=/; ` +
              `HttpOnly; ` +
              `Secure; ` +
              `SameSite=Strict; ` +
              `Max-Age=${SESSION_MAX_AGE}`
          }
        }
      );
    }


    // -----------------------------------------
    // LOGOUT
    // -----------------------------------------

    if (url.pathname === "/logout") {

      return new Response(
        null,
        {
          status: 302,
          headers: {
            "Location": "/login",

            "Set-Cookie":
              `${COOKIE_NAME}=; ` +
              `Path=/; ` +
              `HttpOnly; ` +
              `Secure; ` +
              `SameSite=Strict; ` +
              `Max-Age=0`
          }
        }
      );
    }


    // -----------------------------------------
    // EVERYTHING BELOW THIS LINE
    // REQUIRES A VALID LOGIN
    // -----------------------------------------

    const sessionCookie =
      getCookie(
        request,
        COOKIE_NAME
      );

    const authenticated =
      await validSession(
        sessionCookie,
        env.SESSION_SECRET
      );

    if (!authenticated) {

      // API requests should receive 401,
      // rather than HTML from the login page.

      if (
        url.pathname.startsWith("/api/")
      ) {
        return Response.json(
          {
            ok: false,
            error: "Unauthorised"
          },
          {
            status: 401
          }
        );
      }

      return new Response(
        null,
        {
          status: 302,
          headers: {
            "Location": "/login"
          }
        }
      );
    }


    // -----------------------------------------
    // PROTECTED COMMENTS API - READ
    // -----------------------------------------

    if (
      url.pathname === "/api/comments" &&
      request.method === "GET"
    ) {
      return getComments(
        url,
        env
      );
    }


    // -----------------------------------------
    // PROTECTED COMMENTS API - WRITE
    // -----------------------------------------

    if (
      url.pathname === "/api/comments" &&
      request.method === "POST"
    ) {
      return saveComment(
        request,
        env
      );
    }


    // -----------------------------------------
    // UNKNOWN API ROUTE
    // -----------------------------------------

    if (
      url.pathname.startsWith("/api/")
    ) {
      return Response.json(
        {
          ok: false,
          error: "Not found"
        },
        {
          status: 404
        }
      );
    }


    // -----------------------------------------
    // DASHBOARD STATIC FILES
    // -----------------------------------------

    return env.ASSETS.fetch(request);
  },


  // -------------------------------------------
  // DELETE COMMENTS OLDER THAN 30 DAYS
  // -------------------------------------------

  async scheduled(event, env, ctx) {

    await env.DB
      .prepare(`
        DELETE FROM otl_comments
        WHERE datetime(updated_at)
          < datetime('now', '-30 days')
      `)
      .run();
  }

};
