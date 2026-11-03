import { describe, it, expect } from "vitest";
import { validatePassword } from "../../lib/password";

describe("validatePassword", () => {
  it("accepts a valid password with letters and numbers", () => {
    expect(validatePassword("Travel99")).toBe("");
    expect(validatePassword("abc12345")).toBe("");
    expect(validatePassword("Hello123World")).toBe("");
  });

  it("rejects passwords shorter than 8 characters", () => {
    expect(validatePassword("Abc1")).not.toBe("");
    expect(validatePassword("Ab1")).not.toBe("");
  });

  it("rejects passwords with no letters", () => {
    expect(validatePassword("12345678")).not.toBe("");
    expect(validatePassword("99999999")).not.toBe("");
  });

  it("rejects passwords with no numbers", () => {
    expect(validatePassword("abcdefgh")).not.toBe("");
    expect(validatePassword("PasswordOnly")).not.toBe("");
  });

  it("rejects empty string", () => {
    expect(validatePassword("")).not.toBe("");
  });
});
