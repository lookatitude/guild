/**
 * Tests for the neutral command registry (scripts/lib/command-registry.ts) —
 * P2-Wave-2 lane LW2-3 / SC-W2-3.
 *
 * Proves the renderer is BYTE-IDENTICAL to the committed corpus and that the
 * validator FAILS CLOSED. The authoritative parity gate (per-command equivalence
 * + the SC-W2-5 live-surface guard) is eval-engineer's (LW2-6) — these are the
 * lane's own self-proof that render/extract round-trip and the schema is sound.
 *
 * HARD INVARIANT under test: renders go to temp/staging ONLY — `resolveStagingPath`
 * THROWS if pointed at a live `commands/` tree (R2). No test writes into the live
 * surface; the corpus files are read ONLY as comparison oracles.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  COMMAND_SCHEMA_VERSION,
  CommandV1,
  CommandRegistryV1,
  validateCommandV1,
  validateCommandRegistryV1,
  renderCommandV1,
  extractCommandV1,
  resolveStagingPath,
} from "../lib/command-registry";

const COMMANDS_DIR = path.resolve(__dirname, "..", "..", "commands");

function listCommandFiles(): string[] {
  return fs
    .readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

/** A minimal known-good entry used by the validator/renderer unit tests. */
function goodEntry(over: Partial<CommandV1> = {}): CommandV1 {
  return {
    id: "demo",
    name: "demo",
    description: "A demo command — does a thing.",
    argument_hint: "[--flag]",
    allowed_tools: ["Read", "Bash", "Skill"],
    body: "\n# /guild:demo\n\nBody text.\n",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// BYTE-IDENTICAL round-trip over the WHOLE committed corpus (the oracle)
// ---------------------------------------------------------------------------

describe("render(extract(file)) === file — byte-identical over the live corpus", () => {
  const files = listCommandFiles();

  it("the corpus is non-empty and includes the tricky-quoting oracles (anti-vacuity)", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    // these specific files exercise escaped quotes / long descriptions / empty
    // argument-hint — the parity proof is vacuous if they are not present.
    for (const must of ["status.md", "config.md", "fix.md", "initiative.md", "wiki.md", "audit.md"]) {
      expect(files).toContain(must);
    }
  });

  for (const file of files) {
    it(`commands/${file} round-trips byte-for-byte`, () => {
      const id = file.replace(/\.md$/, "");
      const originalBuf = fs.readFileSync(path.join(COMMANDS_DIR, file)); // raw bytes
      const original = originalBuf.toString("utf8");

      const entry = extractCommandV1(id, original);
      expect(entry).not.toBeNull();

      // the extracted entry is itself schema-valid
      expect(validateCommandV1(entry!)).toEqual({ valid: true, errors: [] });

      // and renders back to the EXACT committed BYTES (binary comparison — no
      // LF/CRLF normalization is applied; the rendered UTF-8 must equal the file).
      const rendered = renderCommandV1(entry!);
      expect(rendered).toBe(original);
      expect(Buffer.from(rendered, "utf8").equals(originalBuf)).toBe(true);
    });
  }

  it("extract derives id==name and a non-empty allowed_tools list for every command", () => {
    for (const file of files) {
      const id = file.replace(/\.md$/, "");
      const original = fs.readFileSync(path.join(COMMANDS_DIR, file), "utf8");
      const entry = extractCommandV1(id, original)!;
      expect(entry.name).toBe(id); // corpus invariant: filename stem == frontmatter name
      expect(entry.allowed_tools.length).toBeGreaterThan(0);
    }
  });

  it("a full registry built from the corpus validates and round-trips per entry", () => {
    const commands: CommandV1[] = files.map((file) => {
      const id = file.replace(/\.md$/, "");
      const original = fs.readFileSync(path.join(COMMANDS_DIR, file), "utf8");
      return extractCommandV1(id, original)!;
    });
    const registry: CommandRegistryV1 = {
      schema_version: COMMAND_SCHEMA_VERSION,
      commands,
    };
    expect(validateCommandRegistryV1(registry)).toEqual({ valid: true, errors: [] });

    for (const c of commands) {
      const file = path.join(COMMANDS_DIR, `${c.id}.md`);
      expect(renderCommandV1(c)).toBe(fs.readFileSync(file, "utf8"));
    }
  });
});

// ---------------------------------------------------------------------------
// Renderer faithfulness — frontmatter shape, escaping, body verbatim
// ---------------------------------------------------------------------------

describe("renderCommandV1 — exact host-native shape", () => {
  it("emits the corpus key order + comma-joined allowed-tools + verbatim body", () => {
    const out = renderCommandV1(goodEntry());
    expect(out).toBe(
      [
        "---",
        "name: demo",
        'description: "A demo command — does a thing."',
        'argument-hint: "[--flag]"',
        "allowed-tools: Read, Bash, Skill",
        "---",
        "",
        "# /guild:demo",
        "",
        "Body text.",
        "",
      ].join("\n"),
    );
  });

  it("escapes ONLY backslash and double-quote in quoted scalars (matches the corpus)", () => {
    const out = renderCommandV1(
      goodEntry({ argument_hint: 'a "b" c', description: 'x "y"' }),
    );
    expect(out).toContain('description: "x \\"y\\""');
    expect(out).toContain('argument-hint: "a \\"b\\" c"');
    // round-trips through extract back to the logical (unescaped) values
    const back = extractCommandV1("demo", out)!;
    expect(back.description).toBe('x "y"');
    expect(back.argument_hint).toBe('a "b" c');
  });

  it("renders an empty argument-hint as \"\" (the corpus's audit.md shape)", () => {
    const out = renderCommandV1(goodEntry({ argument_hint: "" }));
    expect(out).toContain('argument-hint: ""');
  });

  it("is deterministic — repeated renders are identical (no clock/random)", () => {
    const e = goodEntry();
    expect(renderCommandV1(e)).toBe(renderCommandV1(e));
  });

  it("THROWS rather than emit a non-faithful artifact for an invalid entry", () => {
    expect(() => renderCommandV1(goodEntry({ name: "bad name" }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Validator — fail-closed on every required field + render-safety predicate
// ---------------------------------------------------------------------------

describe("validateCommandV1 — fail closed", () => {
  it("accepts a clean entry", () => {
    expect(validateCommandV1(goodEntry())).toEqual({ valid: true, errors: [] });
  });

  it("rejects a non-object", () => {
    expect(validateCommandV1(null).valid).toBe(false);
    expect(validateCommandV1("x").valid).toBe(false);
    expect(validateCommandV1([]).valid).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const res = validateCommandV1({ ...goodEntry(), extra: 1 } as unknown);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/unknown key/);
  });

  it("rejects a missing/empty required field", () => {
    expect(validateCommandV1(goodEntry({ description: "" })).valid).toBe(false);
    expect(validateCommandV1({ ...goodEntry(), name: undefined } as unknown).valid).toBe(false);
    expect(validateCommandV1({ ...goodEntry(), body: undefined } as unknown).valid).toBe(false);
  });

  it("rejects a name/id that is not a lowercase command-id stem", () => {
    expect(validateCommandV1(goodEntry({ name: "has space" })).valid).toBe(false);
    expect(validateCommandV1(goodEntry({ id: "has:colon" })).valid).toBe(false);
    // uppercase / underscore are NOT command stems (would stage a non-matching filename)
    expect(validateCommandV1(goodEntry({ id: "Status", name: "Status" })).valid).toBe(false);
    expect(validateCommandV1(goodEntry({ id: "my_cmd", name: "my_cmd" })).valid).toBe(false);
    // a hyphenated lowercase stem is allowed
    expect(validateCommandV1(goodEntry({ id: "my-cmd", name: "my-cmd" })).valid).toBe(true);
  });

  it("rejects control chars / newlines in quoted values (not byte-renderable)", () => {
    expect(validateCommandV1(goodEntry({ description: "line1\nline2" })).valid).toBe(false);
    expect(validateCommandV1(goodEntry({ argument_hint: "tab\there" })).valid).toBe(false);
  });

  it("rejects an empty allowed_tools or a token with a comma/whitespace/newline", () => {
    expect(validateCommandV1(goodEntry({ allowed_tools: [] })).valid).toBe(false);
    expect(validateCommandV1(goodEntry({ allowed_tools: ["Read, Bash"] })).valid).toBe(false);
    expect(validateCommandV1(goodEntry({ allowed_tools: [" Read"] })).valid).toBe(false);
    // FINDING-1 regression: an embedded newline must NOT pass (would break the
    // one-line allowed-tools frontmatter value).
    expect(validateCommandV1(goodEntry({ allowed_tools: ["Read\nGrep"] })).valid).toBe(false);
    expect(validateCommandV1(goodEntry({ allowed_tools: ["Read\tGrep"] })).valid).toBe(false);
  });

  it("rejects name !== id (corpus coupling)", () => {
    expect(validateCommandV1(goodEntry({ id: "status", name: "statuz" })).valid).toBe(false);
  });

  it("accepts an empty argument_hint but REJECTS an empty body", () => {
    expect(validateCommandV1(goodEntry({ argument_hint: "" })).valid).toBe(true);
    expect(validateCommandV1(goodEntry({ body: "" })).valid).toBe(false);
  });

  it("rejects a non-canonical body shape (leading blank lines / trailing newline)", () => {
    // zero blank line after the fence
    expect(validateCommandV1(goodEntry({ body: "# h\n" })).valid).toBe(false);
    // two blank lines after the fence
    expect(validateCommandV1(goodEntry({ body: "\n\n# h\n" })).valid).toBe(false);
    // no trailing newline
    expect(validateCommandV1(goodEntry({ body: "\n# h" })).valid).toBe(false);
    // two trailing newlines
    expect(validateCommandV1(goodEntry({ body: "\n# h\n\n" })).valid).toBe(false);
    // canonical (one blank line + single trailing newline) passes
    expect(validateCommandV1(goodEntry({ body: "\n# h\n" })).valid).toBe(true);
  });
});

describe("validateCommandRegistryV1 — fail closed", () => {
  it("accepts a clean registry", () => {
    const reg: CommandRegistryV1 = { schema_version: COMMAND_SCHEMA_VERSION, commands: [goodEntry()] };
    expect(validateCommandRegistryV1(reg)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a wrong/absent schema_version", () => {
    expect(validateCommandRegistryV1({ schema_version: "x", commands: [goodEntry()] }).valid).toBe(false);
    expect(validateCommandRegistryV1({ commands: [goodEntry()] }).valid).toBe(false);
  });

  it("rejects an empty commands array", () => {
    expect(validateCommandRegistryV1({ schema_version: COMMAND_SCHEMA_VERSION, commands: [] }).valid).toBe(false);
  });

  it("rejects duplicate command ids", () => {
    const reg = {
      schema_version: COMMAND_SCHEMA_VERSION,
      commands: [goodEntry({ id: "dup", name: "dup" }), goodEntry({ id: "dup", name: "dup" })],
    };
    const res = validateCommandRegistryV1(reg);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/duplicate command id: dup/);
  });

  it("propagates a bad entry's errors with its index", () => {
    const reg = {
      schema_version: COMMAND_SCHEMA_VERSION,
      commands: [goodEntry(), goodEntry({ description: "" })],
    };
    const res = validateCommandRegistryV1(reg);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/commands\[1\]/);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed on hostile input — validators NEVER throw (throwing getters / Proxy)
// ---------------------------------------------------------------------------

describe("validators never throw on hostile input", () => {
  it("validateCommandV1 returns {valid:false} for an entry with a throwing getter", () => {
    const hostile = {
      get id(): string {
        throw new Error("boom from getter");
      },
      name: "x",
    };
    const res = validateCommandV1(hostile);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/threw/);
  });

  it("validateCommandV1 returns {valid:false} for a Proxy that throws on any access", () => {
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error("boom from proxy get");
        },
        ownKeys() {
          throw new Error("boom from proxy ownKeys");
        },
      },
    );
    const res = validateCommandV1(proxy);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/threw/);
  });

  it("validateCommandRegistryV1 returns {valid:false} for a throwing-getter registry", () => {
    const hostile = {
      schema_version: COMMAND_SCHEMA_VERSION,
      get commands(): unknown[] {
        throw new Error("boom from registry getter");
      },
    };
    const res = validateCommandRegistryV1(hostile);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/threw/);
  });

  it("validateCommandV1 survives a thrown object whose toString() ALSO throws", () => {
    // The thrown value is unstringifiable: String(err) would re-throw and escape
    // the catch (fail-OPEN). The fix reads err.message only for real Errors.
    const unstringifiable = {
      toString(): string {
        throw new Error("toString boom");
      },
    };
    const hostile = {
      get id(): string {
        throw unstringifiable;
      },
      name: "x",
    };
    let res: ReturnType<typeof validateCommandV1>;
    expect(() => {
      res = validateCommandV1(hostile);
    }).not.toThrow();
    expect(res!.valid).toBe(false);
    expect(res!.errors.join(" ")).toMatch(/unknown error/);
  });

  it("validateCommandRegistryV1 survives a thrown unstringifiable object", () => {
    const unstringifiable = {
      toString(): string {
        throw new Error("toString boom");
      },
    };
    const hostile = {
      schema_version: COMMAND_SCHEMA_VERSION,
      get commands(): unknown[] {
        throw unstringifiable;
      },
    };
    let res: ReturnType<typeof validateCommandRegistryV1>;
    expect(() => {
      res = validateCommandRegistryV1(hostile);
    }).not.toThrow();
    expect(res!.valid).toBe(false);
    expect(res!.errors.join(" ")).toMatch(/unknown error/);
  });

  it("validateCommandRegistryV1 survives a hostile entry inside the array", () => {
    const reg = {
      schema_version: COMMAND_SCHEMA_VERSION,
      commands: [
        new Proxy(
          {},
          {
            get() {
              throw new Error("boom");
            },
          },
        ),
      ],
    };
    const res = validateCommandRegistryV1(reg);
    expect(res.valid).toBe(false); // never throws; reports fail-closed
  });
});

// ---------------------------------------------------------------------------
// extractCommandV1 — fail-soft on malformed input
// ---------------------------------------------------------------------------

describe("extractCommandV1", () => {
  it("returns null when there is no frontmatter", () => {
    expect(extractCommandV1("x", "# just a body\n")).toBeNull();
  });

  it("captures the body verbatim including the leading blank line", () => {
    const file = "---\nname: x\ndescription: \"d\"\nargument-hint: \"\"\nallowed-tools: Read\n---\n\n# h\n";
    const e = extractCommandV1("x", file)!;
    expect(e.body).toBe("\n# h\n");
  });
});

// ---------------------------------------------------------------------------
// R2 live-surface guard — renders target temp/staging ONLY
// ---------------------------------------------------------------------------

describe("resolveStagingPath — anchored, symlink-aware live-surface guard", () => {
  const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

  it("returns an absolute <stagingDir>/<id>.md for a temp dir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cmd-stage-"));
    const p = resolveStagingPath(tmp, "status");
    expect(p).toBe(path.join(tmp, "status.md"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("ALLOWS a temp dir that merely happens to be named like a live surface", () => {
    // the guard anchors to the REAL plugin root, not to any path segment — a tmp
    // dir named "commands" is NOT the live install surface, so it is permitted.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cmd-stage-"));
    const named = path.join(tmp, "commands");
    fs.mkdirSync(named);
    expect(resolveStagingPath(named, "status")).toBe(path.join(named, "status.md"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("THROWS for the REAL live commands/ tree (anchored to the plugin root)", () => {
    expect(() => resolveStagingPath(COMMANDS_DIR, "status")).toThrow(/live surface/);
    expect(() =>
      resolveStagingPath(path.join(COMMANDS_DIR, "nested"), "status"),
    ).toThrow(/live surface/);
  });

  it("THROWS for the REAL live skills/ and .claude-plugin/ trees", () => {
    expect(() => resolveStagingPath(path.join(PLUGIN_ROOT, "skills"), "status")).toThrow(
      /live surface/,
    );
    expect(() =>
      resolveStagingPath(path.join(PLUGIN_ROOT, ".claude-plugin"), "status"),
    ).toThrow(/live surface/);
  });

  it("THROWS when a SYMLINKED staging root points into the live commands/ tree", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cmd-stage-"));
    const link = path.join(tmp, "sneaky");
    try {
      fs.symlinkSync(COMMANDS_DIR, link, "dir"); // link → real live commands/
    } catch {
      // symlink creation can be denied in some sandboxes; skip rather than false-pass
      fs.rmSync(tmp, { recursive: true, force: true });
      return;
    }
    // canonicalization resolves the symlink to the real live root → rejected
    expect(() => resolveStagingPath(link, "status")).toThrow(/live surface/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("THROWS on an unsafe id (path traversal via the filename)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cmd-stage-"));
    expect(() => resolveStagingPath(tmp, "../escape")).toThrow(/unsafe/);
    expect(() => resolveStagingPath(tmp, "a/b")).toThrow(/unsafe/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the live corpus is never written by these tests (sanity)", () => {
    // a render produces a STRING; nothing here writes to COMMANDS_DIR
    const before = fs.readdirSync(COMMANDS_DIR).sort();
    renderCommandV1(goodEntry());
    expect(fs.readdirSync(COMMANDS_DIR).sort()).toEqual(before);
  });
});
