import { describe, expect, it } from "vitest";
import { isAuthPagePath } from "./auth-paths";

describe("isAuthPagePath", () => {
  it.each(["/login", "/login/", "/register", "/register/", "/invite/abc123", "/invite/abc123/"])(
    "treats %s as an auth page",
    (p) => expect(isAuthPagePath(p)).toBe(true),
  );

  it.each(["/", "/invite", "/invite/", "/invitations", "/loginx", "/settings/team", "/api/auth/login", "/registered"])(
    "does not treat %s as an auth page",
    (p) => expect(isAuthPagePath(p)).toBe(false),
  );
});
