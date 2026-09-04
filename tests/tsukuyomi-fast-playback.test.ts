import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  firstStableTsukuyomiChunk,
  splitTsukuyomiForFastPlayback,
} from "../src/lib/tsukuyomi-fast-playback";

test("fast Tsukuyomi playback can start at the first natural pause", () => {
  assert.equal(firstStableTsukuyomiChunk("おつかれ〜。今日はどうだった？"), "おつかれ〜。");
  assert.deepEqual(
    splitTsukuyomiForFastPlayback("おつかれ〜。今日はどうだった？"),
    ["おつかれ〜。", "今日はどうだった?"],
  );
});

test("short unfinished partial speech is not synthesized speculatively", () => {
  assert.equal(firstStableTsukuyomiChunk("ねえ、ちょっと"), "ねえ、");
  assert.equal(firstStableTsukuyomiChunk("まだ途中"), null);
});

test("long speech without punctuation gets a bounded first chunk", () => {
  const text = "これは句読点がまだ来ないままかなり長く続いている返答です";
  const first = firstStableTsukuyomiChunk(text);
  assert.ok(first);
  assert.ok(first.endsWith("、"));
  assert.ok(first.length <= 25);
});

test("Tsukuyomi lookahead starts from audio-start and keeps iPhone WAV retention bounded", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/tsukuyomi-fast-playback.ts"),
    "utf8",
  );
  const beginPrefetchAt = source.indexOf("const beginPrefetch = () =>");
  const onStartedAt = source.indexOf("const onChunkStarted = () =>", beginPrefetchAt);
  const invokeAt = source.indexOf("beginPrefetch();", onStartedAt);
  const playbackAt = source.indexOf("const played = await playBlobToEnd", onStartedAt);
  assert.ok(beginPrefetchAt >= 0);
  assert.ok(onStartedAt > beginPrefetchAt);
  assert.ok(invokeAt > onStartedAt && invokeAt < playbackAt);
  assert.match(source, /return isAppleMobileWebKit\(\) \? 2 : 4/);
  assert.match(source, /pipelineAbort\.abort\(\)/);
});
