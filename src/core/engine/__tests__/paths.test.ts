import { describe, expect, it } from "vitest";
import { cleanPathText, decodeLinkTarget, looksLikePath, pathCandidates } from "@/core/chat/paths";

describe("chemins cités par une IA", () => {
  it("reconnaît chemins absolus, relatifs et noms de fichiers", () => {
    expect(looksLikePath(String.raw`C:\Users\user\.gemini\antigravity-cli\scratch\testing_ARCHIMED`)).toBe(true);
    expect(looksLikePath("F:/Coding/SDAI ARCHIMED/README.md")).toBe(true);
    expect(looksLikePath("src/core/chat/Composer.tsx")).toBe(true);
    expect(looksLikePath("popup.bat")).toBe(true);
    expect(looksLikePath("IMG-20260915-WA0001.jpg")).toBe(true);
    expect(looksLikePath("src/main.rs:42:7")).toBe(true);
  });

  it("ignore le code, les URL et les versions", () => {
    expect(looksLikePath("pnpm test")).toBe(false);
    expect(looksLikePath("https://example.com/a.txt")).toBe(false);
    expect(looksLikePath("1.2.3")).toBe(false);
    expect(looksLikePath("useState")).toBe(false);
    expect(looksLikePath("a.b()")).toBe(false);
  });

  it("extrait les candidats d'un message markdown", () => {
    const text = [
      "J'ai créé `popup.bat` dans `C:\\tmp\\scratch`.",
      "Lancez `pnpm check` puis voyez [le README](file:///F:/Coding/SDAI%20ARCHIMED/README.md).",
      "```\nnot/a/candidate.txt\n```",
    ].join("\n");
    expect(pathCandidates(text)).toEqual(["popup.bat", "C:\\tmp\\scratch", "F:/Coding/SDAI ARCHIMED/README.md"]);
  });

  it("reprend les liens file:/// réellement produits par agy", () => {
    const text = "Created [hello.txt](file:///C:/Users/user/Temp/cwdtest/hello.txt) with the content `hi`. Voir [doc](https://example.com/a.md).";
    expect(pathCandidates(text)).toEqual(["C:/Users/user/Temp/cwdtest/hello.txt"]);
    expect(decodeLinkTarget("file:///F:/p/src/main.rs#L12")).toBe("F:/p/src/main.rs");
  });

  it("nettoie les décorations", () => {
    expect(cleanPathText('"src/a.ts:12",')).toBe("src/a.ts");
    expect(decodeLinkTarget("file:///C:/x%20y")).toBe("C:/x y");
  });
});
