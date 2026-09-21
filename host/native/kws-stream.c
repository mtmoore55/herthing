#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sherpa-onnx/c-api/c-api.h"

static void usage(const char *program) {
  fprintf(stderr,
          "usage: %s ENCODER DECODER JOINER TOKENS KEYWORDS [THRESHOLD]\n",
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
  const SherpaOnnxOnlineStream *stream =
      SherpaOnnxCreateKeywordStream(spotter);
  if (!stream) {
    fprintf(stderr, "failed to create keyword stream\n");
    SherpaOnnxDestroyKeywordSpotter(spotter);
    return 1;
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
    SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, samples,
                                         (int32_t)count);
    while (SherpaOnnxIsKeywordStreamReady(spotter, stream)) {
      SherpaOnnxDecodeKeywordStream(spotter, stream);
    }
    const SherpaOnnxKeywordResult *result =
        SherpaOnnxGetKeywordResult(spotter, stream);
    if (result && result->keyword && result->keyword[0]) {
      puts(result->json);
      fflush(stdout);
      SherpaOnnxResetKeywordStream(spotter, stream);
    }
    SherpaOnnxDestroyKeywordResult(result);
  }

  SherpaOnnxDestroyOnlineStream(stream);
  SherpaOnnxDestroyKeywordSpotter(spotter);
  return ferror(stdin) ? 1 : 0;
}
