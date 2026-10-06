import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../desktop-session", () => ({ saveDesktopToken: vi.fn().mockResolvedValue(undefined) }));

import { invoke } from "@tauri-apps/api/core";
import { saveDesktopToken } from "../desktop-session";
import {
  beginDesktopLogin,
  cancelDesktopLogin,
  handleNativeCallback,
  NativeLoginError,
  _resetNativeLoginForTests,
} from "../desktop-native-login";

const invokeMock = vi.mocked(invoke);

function makeApi(exchangeResult: { sessionToken?: string | null } | Error = { sessionToken: "tok_123" }) {
  return {
    start: vi.fn().mockResolvedValue({ requestId: "0b7e1f4a-6c1d-4f6e-9a55-3f0c2f6b9a11" }),
    exchange: vi.fn().mockImplementation(async () => {
      if (exchangeResult instanceof Error) throw exchangeResult;
      return exchangeResult;
    }),
  };
}

async function started(api = makeApi()) {
  const promise = beginDesktopLogin(api);
  const settled = promise.then(
    () => "ok",
    (e: unknown) => e,
  );
  await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith("open_external_url", expect.anything()));
  const startInput = api.start.mock.calls[0][0];
  return { api, settled, startInput };
}

describe("desktop native login", () => {
  beforeEach(() => {
    _resetNativeLoginForTests();
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "start_native_login" ? 53211 : undefined));
  });

  it("runs PKCE start -> browser -> callback -> exchange -> keychain", async () => {
    const { api, settled, startInput } = await started();
    expect(startInput).toMatchObject({
      client: "desktop",
      redirectUri: "http://127.0.0.1:53211/callback",
      codeChallengeMethod: "S256",
    });
    expect(startInput.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invokeMock).toHaveBeenCalledWith("start_native_login", { state: startInput.state });
    const openCall = invokeMock.mock.calls.find((c) => c[0] === "open_external_url")!;
    expect((openCall[1] as { url: string }).url).toMatch(/\/auth\/native\?request=0b7e1f4a-/);

    await handleNativeCallback({ code: "c".repeat(43), state: startInput.state });
    expect(await settled).toBe("ok");
    expect(api.exchange).toHaveBeenCalledWith({
      requestId: "0b7e1f4a-6c1d-4f6e-9a55-3f0c2f6b9a11",
      code: "c".repeat(43),
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(saveDesktopToken).toHaveBeenCalledWith("tok_123");
  });

  it("ignores callbacks with a mismatched state", async () => {
    const { api, settled, startInput } = await started();
    await handleNativeCallback({ code: "c".repeat(43), state: "x".repeat(32) });
    expect(api.exchange).not.toHaveBeenCalled();
    cancelDesktopLogin();
    const err = await settled;
    expect(err).toBeInstanceOf(NativeLoginError);
    expect((err as NativeLoginError).kind).toBe("cancelled");
    expect(startInput.state).not.toBe("x".repeat(32));
  });

  it("allows retry after a failed exchange", async () => {
    const first = await started(makeApi(new Error("bad")));
    await handleNativeCallback({ code: "c".repeat(43), state: first.startInput.state });
    const err = await first.settled;
    expect((err as NativeLoginError).kind).toBe("failed");
    expect(saveDesktopToken).not.toHaveBeenCalled();

    invokeMock.mockClear();
    const second = await started();
    await handleNativeCallback({ code: "d".repeat(43), state: second.startInput.state });
    expect(await second.settled).toBe("ok");
  });

  it("fails cleanly when the browser cannot be opened", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "start_native_login") return 4000;
      throw new Error("denied");
    });
    await expect(beginDesktopLogin(makeApi())).rejects.toMatchObject({ kind: "failed" });
  });
});
