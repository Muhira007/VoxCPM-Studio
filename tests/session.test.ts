import assert from "node:assert/strict";
import { test } from "node:test";
import { serverConfig } from "../src/server/config.ts";
import { requireStudioAccess } from "../src/server/http.ts";
import {
  createSessionToken,
  passwordMatches,
  requestHasSameOrigin,
  requestIsSecure,
  verifySessionToken,
} from "../src/server/session.ts";

const secret = "session-test-secret-with-at-least-32-characters";

test("studio session token verifies, expires, and rejects tampering", () => {
  const now = Date.UTC(2026, 8, 21, 0, 0, 0);
  const session = createSessionToken(secret, now);
  assert.equal(verifySessionToken(session.token, secret, now).authenticated, true);
  assert.equal(
    verifySessionToken(session.token, `${secret}-different`, now).authenticated,
    false,
  );
  assert.equal(
    verifySessionToken(`${session.token.slice(0, -1)}x`, secret, now)
      .authenticated,
    false,
  );
  assert.equal(
    verifySessionToken(session.token, secret, session.expiresAt).authenticated,
    false,
  );
});

test("API access accepts a valid HttpOnly session and protects cookie mutations by origin", () => {
  const previous = { ...serverConfig };
  Object.assign(serverConfig, {
    workerUrl: "http://127.0.0.1:8001",
    workerApiKey: "worker-test-key-with-at-least-32-characters",
    studioApiKey: "studio-test-key-with-at-least-32-characters",
    studioAccessPassword: "studio-password-test",
    studioSessionSecret: secret,
  });
  try {
    const session = createSessionToken(secret);
    const cookie = `voxcpm_studio_session=${session.token}`;
    assert.equal(
      requireStudioAccess(
        new Request("http://127.0.0.1:3000/api/v1/settings", {
          headers: { cookie },
        }),
      ),
      null,
    );
    assert.equal(
      requireStudioAccess(
        new Request("http://127.0.0.1:3000/api/v1/settings", {
          method: "PUT",
          headers: { cookie },
        }),
      )?.status,
      403,
    );
    assert.equal(
      requireStudioAccess(
        new Request("http://127.0.0.1:3000/api/v1/settings", {
          method: "PUT",
          headers: {
            cookie,
            origin: "http://127.0.0.1:3000",
          },
        }),
      ),
      null,
    );
    assert.equal(
      requireStudioAccess(
        new Request("http://127.0.0.1:3000/api/v1/settings", {
          method: "PUT",
          headers: {
            "x-studio-key": serverConfig.studioApiKey,
          },
        }),
      ),
      null,
    );
  } finally {
    Object.assign(serverConfig, previous);
  }
});

test("password and same-origin checks fail closed", () => {
  assert.equal(passwordMatches("correct-password", "correct-password"), true);
  assert.equal(passwordMatches("wrong", "correct-password"), false);
  assert.equal(
    requestHasSameOrigin(
      new Request("http://127.0.0.1:3000/api/v1/jobs", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3000" },
      }),
    ),
    true,
  );
  assert.equal(
    requestHasSameOrigin(
      new Request("http://localhost:3000/api/v1/jobs", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
        },
      }),
    ),
    true,
  );
  assert.equal(
    requestHasSameOrigin(
      new Request("http://127.0.0.1:3000/api/v1/jobs", {
        method: "POST",
        headers: { origin: "https://example.com" },
      }),
    ),
    false,
  );
  assert.equal(
    requestHasSameOrigin(
      new Request("http://127.0.0.1:3000/api/v1/jobs", { method: "POST" }),
    ),
    false,
  );
  assert.equal(
    requestIsSecure(
      new Request("http://localhost/api", {
        headers: { "x-forwarded-proto": "https" },
      }),
    ),
    true,
  );
});
