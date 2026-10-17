import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLrc, plainLines, isReallySynced, unsync } from "../background/lrc.js";

test("parseLrc reads common timestamp formats", () => {
  const lines = parseLrc("[00:01.50]one\n[00:02.123]two\n[00:03]three\n[1:04:5]four");
  assert.deepEqual(
    lines.map((l) => [l.t, l.text]),
    [
      [1.5, "one"],
      [2.123, "two"],
      [3, "three"],
      [64.5, "four"],
    ]
  );
});

test("parseLrc expands lines with several timestamps and sorts them", () => {
  const lines = parseLrc("[00:10.00][00:30.00]chorus\n[00:20.00]verse");
  assert.deepEqual(lines.map((l) => l.text), ["chorus", "verse", "chorus"]);
});

test("parseLrc drops metadata, credits and section headers", () => {
  const text = [
    "[ar: Daft Punk]",
    "[ti: Something About Us]",
    "[00:00.00] 作词 : Thomas Bangalter",
    "[00:01.00] 作曲 : Guy-Manuel",
    "[00:01.10]Producer: Someone",
    "[00:01.358][Intro]",
    "[00:02.00]It  might  not  be  the  right  time",
  ].join("\n");
  const lines = parseLrc(text);
  assert.deepEqual(lines, [{ t: 2, text: "It might not be the right time" }]);
});

test("parseLrc applies [offset]", () => {
  assert.equal(parseLrc("[offset:+500]\n[00:10.00]x")[0].t, 9.5);
  assert.equal(parseLrc("[offset:-500]\n[00:10.00]x")[0].t, 10.5);
  assert.equal(parseLrc("[offset:+20000]\n[00:10.00]x")[0].t, 0); // never negative
});

test("parseLrc keeps one instrumental break, not runs of them", () => {
  const lines = parseLrc("[00:01]\n[00:02]a\n[00:03]\n[00:04]\n[00:05]b\n[00:06]\n");
  assert.deepEqual(lines.map((l) => l.text), ["a", "", "b"]);
});

test("parseLrc survives garbage", () => {
  assert.deepEqual(parseLrc(""), []);
  assert.deepEqual(parseLrc(null), []);
  assert.deepEqual(parseLrc("no timestamps here\nat all"), []);
  assert.deepEqual(parseLrc("[99:99.99]"), []);
  assert.doesNotThrow(() => parseLrc("[00:01.00]" + "x".repeat(100000)));
  assert.doesNotThrow(() => parseLrc("[".repeat(50000)));
});

test("isReallySynced rejects lyrics stamped all at 0:00", () => {
  assert.equal(isReallySynced(parseLrc("[00:00.00]a\n[00:00.00]b\n[00:00.00]c")), false);
  assert.equal(isReallySynced(parseLrc("[00:01]a\n[00:02]b\n[00:03]c")), true);
});

test("plainLines drops blanks and [Chorus]-style headers", () => {
  assert.deepEqual(plainLines("[Verse 1]\nHello\n\n  world  \n[Chorus: X]\nbye"), [
    { text: "Hello" },
    { text: "world" },
    { text: "bye" },
  ]);
  assert.deepEqual(plainLines(undefined), []);
});

test("unsync strips timing and breaks", () => {
  assert.deepEqual(unsync([{ t: 1, text: "a" }, { t: 2, text: "" }, { t: 3, text: "b" }]), [{ text: "a" }, { text: "b" }]);
});
