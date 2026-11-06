import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../../worker/input.js";

test("situation と ng があれば整形して返し、native は任意で空文字になる", () => {
  // native を必須にしてしまうバグで失敗する
  assert.deepEqual(normalize({ situation: "会議", ng: "I want" }), { situation: "会議", native: "", ng: "I want" });
});

test("前後の空白は除去される", () => {
  assert.equal(normalize({ situation: "  a \n", ng: "\tb  " }).situation, "a");
});

test("situation または ng が空・空白のみ・欠落なら null", () => {
  for (const b of [
    { situation: "", ng: "x" }, { situation: "   ", ng: "x" }, { ng: "x" },
    { situation: "x", ng: "" }, { situation: "x", ng: " " }, { situation: "x" },
  ]) assert.equal(normalize(b), null, JSON.stringify(b));
});

test("body が null / undefined / 非オブジェクトでも例外を出さず null", () => {
  for (const b of [null, undefined, 5, "str", []]) assert.equal(normalize(b), null);
});

test("文字列以外の値は空として扱う（型の取り違えで落ちない）", () => {
  assert.equal(normalize({ situation: 123, ng: "x" }), null);
  assert.equal(normalize({ situation: ["a"], ng: "x" }), null);
  assert.equal(normalize({ situation: "a", ng: { x: 1 } }), null);
  assert.equal(normalize({ situation: "a", ng: "x", native: 5 }).native, "");
});

test("1項目 400 文字が上限: 超過分は切り詰める（トークン消費の防止）", () => {
  const r = normalize({ situation: "あ".repeat(400), ng: "x".repeat(401), native: "y".repeat(5000) });
  assert.equal(r.situation.length, 400);
  assert.equal(r.ng.length, 400);
  assert.equal(r.native.length, 400);
});

test("未知のキーは出力に含まれない", () => {
  const r = normalize({ situation: "a", ng: "b", model: "evil", prompt: "p" });
  assert.deepEqual(Object.keys(r).sort(), ["native", "ng", "situation"]);
});
