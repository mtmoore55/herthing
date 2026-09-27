#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sherpa-onnx/c-api/c-api.h"

static void usage(const char *program) {
  fprintf(stderr,
          "usage: %s ENCODER DECODER JOINER TOKENS KEYWORDS [THRESHOLD] "
          "[RESET_SECONDS]\n",
          program);
}

int main(int argc, char **argv) {
  if (argc < 6) {
    usage(argv[0]);
    return 2;
  }

  SherpaOnnxKeywordSpotterConfig config;
  memset(&config, 0, sizeof(config));
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.model_config.transducer.encoder = argv[1];
  config.model_config.transducer.decoder = argv[2];
  config.model_config.transducer.joiner = argv[3];
  config.model_config.tokens = argv[4];
  config.model_config.num_threads = 2;
  config.model_config.provider = "cpu";
  config.max_active_paths = 4;
  config.num_trailing_blanks = 1;
  config.keywords_score = 1.0f;
  config.keywords_threshold = argc > 6 ? strtof(argv[6], NULL) : 0.25f;
  config.keywords_file = argv[5];

  const SherpaOnnxKeywordSpotter *spotter =
      SherpaOnnxCreateKeywordSpotter(&config);
  if (!spotter) {
    fprintf(stderr, "failed to create keyword spotter\n");
    return 1;
  }
  // A single keyword stream fed room tone for hours stops detecting the
  // wake word. Run two streams whose resets are staggered by half the
  // interval, so one of them always holds at least half an interval of
  // context and a wake word spanning one stream's reset is still heard by
  // the other. RESET_SECONDS <= 0 keeps a single never-reset stream.
  const double reset_seconds = argc > 7 ? strtod(argv[7], NULL) : 20.0;
  const int64_t reset_samples =
      reset_seconds > 0 ? (int64_t)(reset_seconds * 16000) : 0;
  const int stream_count = reset_samples ? 2 : 1;
  const SherpaOnnxOnlineStream *streams[2] = {NULL, NULL};
  int64_t fed[2] = {0, reset_samples / 2};
  for (int s = 0; s < stream_count; ++s) {
    streams[s] = SherpaOnnxCreateKeywordStream(spotter);
    if (!streams[s]) {
      fprintf(stderr, "failed to create keyword stream\n");
      for (int t = 0; t < s; ++t) SherpaOnnxDestroyOnlineStream(streams[t]);
      SherpaOnnxDestroyKeywordSpotter(spotter);
      return 1;
    }
  }

  int32_t pcm[1600];
  float samples[1600];
  puts("{\"type\":\"ready\"}");
  fflush(stdout);

  while (!feof(stdin) && !ferror(stdin)) {
    size_t count = fread(pcm, sizeof(int32_t), 1600, stdin);
    if (!count) break;
    for (size_t i = 0; i < count; ++i) {
      samples[i] = (float)((double)pcm[i] / 2147483648.0);
    }
    int detected = 0;
    for (int s = 0; s < stream_count && !detected; ++s) {
      const SherpaOnnxOnlineStream *stream = streams[s];
      SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, samples,
                                           (int32_t)count);
      fed[s] += (int64_t)count;
      while (SherpaOnnxIsKeywordStreamReady(spotter, stream)) {
        SherpaOnnxDecodeKeywordStream(spotter, stream);
      }
      const SherpaOnnxKeywordResult *result =
          SherpaOnnxGetKeywordResult(spotter, stream);
      if (result && result->keyword && result->keyword[0]) {
        puts(result->json);
        fflush(stdout);
        detected = 1;
      }
      SherpaOnnxDestroyKeywordResult(result);
    }
    for (int s = 0; s < stream_count; ++s) {
      if (detected) {
        SherpaOnnxResetKeywordStream(spotter, streams[s]);
        fed[s] = s ? reset_samples / 2 : 0;
      } else if (reset_samples && fed[s] >= reset_samples) {
        SherpaOnnxResetKeywordStream(spotter, streams[s]);
        fed[s] = 0;
      }
    }
  }

  for (int s = 0; s < stream_count; ++s) {
    SherpaOnnxDestroyOnlineStream(streams[s]);
  }
  SherpaOnnxDestroyKeywordSpotter(spotter);
  return ferror(stdin) ? 1 : 0;
}
