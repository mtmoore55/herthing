#include <stdint.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sherpa-onnx/c-api/c-api.h"

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: %s MODEL\n", argv[0]);
    return 2;
  }

  size_t capacity = 16000 * 8;
  size_t count = 0;
  int32_t *pcm = malloc(capacity * sizeof(*pcm));
  if (!pcm) return 1;
  while (!feof(stdin) && !ferror(stdin)) {
    if (count == capacity) {
      capacity *= 2;
      int32_t *larger = realloc(pcm, capacity * sizeof(*pcm));
      if (!larger) { free(pcm); return 1; }
      pcm = larger;
    }
    count += fread(pcm + count, sizeof(*pcm), capacity - count, stdin);
  }
  if (ferror(stdin) || count < 16000) {
    fprintf(stderr, "at least one second of S32LE audio is required\n");
    free(pcm);
    return 3;
  }

  float *samples = malloc(count * sizeof(*samples));
  if (!samples) { free(pcm); return 1; }
  const double rc = 1.0 / (2.0 * 3.141592653589793 * 80.0);
  const double alpha = rc / (rc + 1.0 / 16000.0);
  double previous_input = 0.0;
  double previous_output = 0.0;
  for (size_t i = 0; i < count; ++i) {
    double input = (double)pcm[i] / 2147483648.0;
    double filtered = alpha * (previous_output + input - previous_input);
    previous_input = input;
    previous_output = filtered;
    samples[i] = (float)tanh(filtered * 16.0);
  }
  free(pcm);

  SherpaOnnxSpeakerEmbeddingExtractorConfig config;
  memset(&config, 0, sizeof(config));
  config.model = argv[1];
  config.num_threads = 2;
  config.provider = "cpu";
  const SherpaOnnxSpeakerEmbeddingExtractor *extractor =
      SherpaOnnxCreateSpeakerEmbeddingExtractor(&config);
  if (!extractor) { free(samples); return 4; }
  const SherpaOnnxOnlineStream *stream =
      SherpaOnnxSpeakerEmbeddingExtractorCreateStream(extractor);
  SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, samples, (int32_t)count);
  SherpaOnnxOnlineStreamInputFinished(stream);
  free(samples);
  if (!SherpaOnnxSpeakerEmbeddingExtractorIsReady(extractor, stream)) {
    fprintf(stderr, "not enough usable audio for a speaker embedding\n");
    SherpaOnnxDestroyOnlineStream(stream);
    SherpaOnnxDestroySpeakerEmbeddingExtractor(extractor);
    return 5;
  }
  int32_t dim = SherpaOnnxSpeakerEmbeddingExtractorDim(extractor);
  const float *embedding =
      SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(extractor, stream);
  if (!embedding) return 6;
  putchar('[');
  for (int32_t i = 0; i < dim; ++i)
    printf(i ? ",%.9g" : "%.9g", embedding[i]);
  puts("]");
  SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(embedding);
  SherpaOnnxDestroyOnlineStream(stream);
  SherpaOnnxDestroySpeakerEmbeddingExtractor(extractor);
  return 0;
}
