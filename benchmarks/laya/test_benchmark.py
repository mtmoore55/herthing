import importlib.util
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('benchmark',Path(__file__).parent/'benchmark.py')
benchmark=importlib.util.module_from_spec(spec);spec.loader.exec_module(benchmark)

class RuleSafetyTests(unittest.TestCase):
    def test_obvious_supported_commands(self):
        self.assertEqual(benchmark.conservative_rule('stop the song please'),'pause_music')
        self.assertEqual(benchmark.conservative_rule('go to the following track'),'next_track')
        self.assertEqual(benchmark.conservative_rule('bring the volume down a notch'),'volume_down')

    def test_negation_never_executes(self):
        self.assertEqual(benchmark.conservative_rule('do not pause the music'),'fallback')

    def test_quoted_command_never_executes(self):
        self.assertEqual(benchmark.conservative_rule('the phrase pause the music sounds bossy'),'fallback')

    def test_multiple_requests_never_execute(self):
        self.assertEqual(benchmark.conservative_rule('pause this and tell me the weather'),'fallback')

    def test_unresolved_weather_arguments_fall_back(self):
        self.assertEqual(benchmark.conservative_rule('weather in Chicago Friday'),'fallback')

    def test_confident_unsafe_model_result_is_gated(self):
        self.assertEqual(benchmark.safety_gate('do not pause the music','pause_music',1,1,.92),'fallback')

if __name__ == '__main__': unittest.main()
