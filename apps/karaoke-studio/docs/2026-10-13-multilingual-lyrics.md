# Automatic lyrics in other languages — issue #241

## Intended outcome and gap

Automatic lyrics should work for the songs people actually sing, not only English ones. The studio recognized lyrics with NVIDIA Parakeet TDT 0.6B v2, which is English-only. On French songs that model scores 91.5% WER, so non-English clips arrived with unusable lyrics.

## Measurements

The method was JamendoLyrics with the production path: MDX-Net separation, Silero VAD and Parakeet through sherpa-onnx. English songs were evaluated on their first 300 s and the others on their first 120 s. German and Spanish used the first 10 songs of each in dataset order. Per-language summaries are in [the evaluation record](2026-10-13-multilingual-lyrics-evaluation.json).

| Songs | Parakeet v3 (multilingual) | Parakeet v2 (English) | Automatic choice (both installed) |
| --- | --- | --- | --- |
| 20 English | 42.3% | **30.9%** | **30.9%** (v2 chosen for 20/20) |
| 19 French | **44.1%** | 91.5% | **44.1%** (v3 chosen for 19/19) |
| 10 German | **25.4%** | 95.7% | **25.4%** (v3 chosen for 10/10) |
| 10 Spanish | **46.2%** | 86.5% | **46.2%** (v3 chosen for 10/10) |

v3 cannot simply replace v2: it is 11 points worse on English singing. The studio therefore keeps both models.

## Design

- **Two models.** `scripts/setup_lyrics_model.py` installs both models, each checksum-pinned in its own directory: v2 in `lyrics-asr` and v3 in `lyrics-asr-v3`. `--only english|multilingual` installs one, and an existing English-only install keeps working.
- **Language choice.** With both models installed, the worker recognizes phrases with v3 until it has 100 words or the song ends. If those words read as English, it frees v3, loads v2 and recognizes the whole song with v2. Otherwise v3 carries on from where it stopped.
- **English test.** The test counts the share of distinctive English function words among the first 100 words: "the", "and", "you", "don't" and so on. Words that are also common in the other covered languages ("a", "in", "is", "was", "so", "will") are excluded. Across the 59 songs, English songs began with 28–46% such words and the others with at most 9%. The threshold is 18%. Fewer than 5 words count as not English.
- **Transcripts.** A transcript names the model that produced it; both names are valid. The Automatic lyrics panel says which model heard the clip.

## Verification (local, 2026-10-13)

- **Python:** 193 tests pass. New tests cover:
  - the English test, including other-language word lists and the first-words-only rule;
  - the choice with stand-in recognizers: English songs heard again by v2, other songs continuing with v3, each phrase heard once, and a single installed model hearing everything;
  - readiness of either model, and archive matching by pinned size.
- **TypeScript:** 128 unit tests pass, plus lint and typecheck; the automatic-lyrics browser spec checks the named model.
- **Setup:** setup verified and published v3 from the official archive into an empty model directory, and a rerun against an existing install verified both models without changes.

## Not established

- **Speed.** English songs pay for the extra pass: the v3 prefix, a model switch, then v2 on the whole song. In this evaluation, recognition of English songs averaged 42.7 s against 22.9 s with v3 alone, measured while other work shared the CPU.
- **Coverage.** Mixed-language songs are recognized with the model chosen from their first 100 words. Only French, German and Spanish were measured; v3's other 21 languages are untested on singing.
- **Size.** The sample is small: 59 songs.


## Completing the timing evaluation (#241)

The retained multilingual summary above contains WER only. Per-language word-onset and automatic/supplied-line timing measurements still need to be retained; the 2026-10-14 review did not rerun the songs. `scripts/evaluate_lyrics.py` produces those metrics through the production path and now accepts `--model-choice auto|english|multilingual`, matching the studio's retry selection. Run in the documented Python 3.11 ML environment with verified models and the local JamendoLyrics audio/annotations, for example:

```bash
python scripts/evaluate_lyrics.py --dataset /path/to/jamendolyrics --model-dir /path/to/models --work /path/to/evaluation --language French --max-seconds 120 --model-choice auto --output french-auto.json
python scripts/evaluate_lyrics.py --dataset /path/to/jamendolyrics --model-dir /path/to/models --work /path/to/evaluation --language French --max-seconds 120 --model-choice english --output french-english.json
python scripts/evaluate_lyrics.py --dataset /path/to/jamendolyrics --model-dir /path/to/models --work /path/to/evaluation --language French --max-seconds 120 --model-choice multilingual --output french-multilingual.json
```

For the original comparison use all 20 English songs capped at 300 seconds, all 19 French songs capped at 120 seconds, and German/Spanish capped at 120 seconds with `--limit 10`. Keep the dataset order. Share the same work directory to reuse identical separated vocals across recognizers. Cache identity includes audio SHA-256, clip cap, separation-model pin and production code; each recognition result separately includes choice, installed selected-model pins and recognition code. Reports name the actual recognizer and retain these identities. An old unbound `transcript.json` is preserved as historical evidence and is never accepted as a current run. Changing the clip cap, input bytes, model set or implementation cannot silently reuse its timings.

Four injected-inference tests cover distinct chosen-model results sharing identical vocals, source/clip changes, changed installed-model sets and preserved-but-rejected legacy caches. Fixtures verify cache behavior only. The current workspace has neither dataset audio/annotations nor verified models, so real-song results remain required. User-measured correction effort also remains open.
