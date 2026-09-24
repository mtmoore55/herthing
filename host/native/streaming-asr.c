#include <stdint.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sherpa-onnx/c-api/c-api.h"

enum { CMD_START = 1, CMD_AUDIO = 2, CMD_FINISH = 3, CMD_CANCEL = 4 };

static int read_exact(void *buffer, size_t size) {
  return fread(buffer, 1, size, stdin) == size;
}

static void json_text(const char *value) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)(value ? value : ""); *p; ++p) {
    if (*p == '"' || *p == '\\') printf("\\%c", *p);
    else if (*p == '\n') fputs("\\n", stdout);
    else if (*p == '\r') fputs("\\r", stdout);
    else if (*p == '\t') fputs("\\t", stdout);
    else if (*p >= 0x20) putchar(*p);
  }
  putchar('"');
}

static void emit_result(const char *type, const char *text) {
  printf("{\"type\":\"%s\",\"text\":", type);
  json_text(text);
  puts("}");
  fflush(stdout);
}

static char *copy_result(const SherpaOnnxOnlineRecognizer *recognizer,
                         const SherpaOnnxOnlineStream *stream) {
  const SherpaOnnxOnlineRecognizerResult *result =
      SherpaOnnxGetOnlineStreamResult(recognizer, stream);
  const char *text = result && result->text ? result->text : "";
  char *copy = strdup(text);
  SherpaOnnxDestroyOnlineRecognizerResult(result);
  return copy;
}

int main(int argc, char **argv) {
  if (argc < 5) {
    fprintf(stderr, "usage: %s <encoder> <decoder> <joiner> <tokens> [threads]\n", argv[0]);
    return 2;
  }
  setvbuf(stdout, NULL, _IOLBF, 0);

  SherpaOnnxOnlineRecognizerConfig config;
  memset(&config, 0, sizeof(config));
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.model_config.transducer.encoder = argv[1];
  config.model_config.transducer.decoder = argv[2];
  config.model_config.transducer.joiner = argv[3];
  config.model_config.tokens = argv[4];
  config.model_config.num_threads = argc > 5 ? atoi(argv[5]) : 2;
  config.model_config.provider = "cpu";
  config.decoding_method = "greedy_search";

  const SherpaOnnxOnlineRecognizer *recognizer = SherpaOnnxCreateOnlineRecognizer(&config);
  if (!recognizer) {
    fputs("streaming-asr: recognizer initialization failed\n", stderr);
    return 3;
  }
  const SherpaOnnxOnlineStream *stream = NULL;
  char *last_text = strdup("");
  float previous_input = 0.0f;
  float previous_output = 0.0f;
  puts("{\"type\":\"ready\"}");

  for (;;) {
    uint8_t command;
    uint32_t size;
    if (!read_exact(&command, 1)) break;
    if (!read_exact(&size, 4)) break;

    if (command == CMD_START) {
      if (stream) SherpaOnnxDestroyOnlineStream(stream);
      stream = SherpaOnnxCreateOnlineStream(recognizer);
      free(last_text);
      last_text = strdup("");
      previous_input = previous_output = 0.0f;
      continue;
    }
    if (command == CMD_CANCEL) {
      if (stream) SherpaOnnxDestroyOnlineStream(stream);
      stream = NULL;
      continue;
    }
    if (command == CMD_AUDIO) {
      unsigned char *bytes = malloc(size);
      if (!bytes || !read_exact(bytes, size)) { free(bytes); break; }
      if (!stream) { free(bytes); continue; }
      int32_t count = (int32_t)(size / 4);
      float *samples = malloc((size_t)count * sizeof(float));
      if (!samples) { free(bytes); break; }
      const float gain = 15.8489319f;  // 24 dB, matching the Whisper adapter.
      const float alpha = 0.7609428f;  // 80 Hz high-pass at 16 kHz.
      for (int32_t i = 0; i < count; ++i) {
        int32_t raw;
        memcpy(&raw, bytes + i * 4, 4);
        float input = (float)raw / 2147483648.0f;
        float filtered = alpha * (previous_output + input - previous_input);
        previous_input = input;
        previous_output = filtered;
        samples[i] = 0.9f * tanhf(filtered * gain / 0.9f);
      }
      SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, samples, count);
      while (SherpaOnnxIsOnlineStreamReady(recognizer, stream))
        SherpaOnnxDecodeOnlineStream(recognizer, stream);
      char *text = copy_result(recognizer, stream);
      if (strcmp(text, last_text) != 0) {
        emit_result("partial", text);
        free(last_text);
        last_text = text;
      } else free(text);
      free(samples);
      free(bytes);
      continue;
    }
    if (command == CMD_FINISH && stream) {
      SherpaOnnxOnlineStreamInputFinished(stream);
      while (SherpaOnnxIsOnlineStreamReady(recognizer, stream))
        SherpaOnnxDecodeOnlineStream(recognizer, stream);
      char *text = copy_result(recognizer, stream);
      emit_result("final", text);
      free(text);
      SherpaOnnxDestroyOnlineStream(stream);
      stream = NULL;
    }
  }

  if (stream) SherpaOnnxDestroyOnlineStream(stream);
  free(last_text);
  SherpaOnnxDestroyOnlineRecognizer(recognizer);
  return 0;
}
