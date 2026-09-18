import { describe, expect, test } from 'bun:test'
import { describeWeatherCode, fetchWeather, weatherConfig } from './weather.js'

describe('weather adapter', () => {
  test('maps daytime and nighttime clear weather', () => {
    expect(describeWeatherCode(0, true)).toEqual({ condition: 'Clear', symbol: 'sun' })
    expect(describeWeatherCode(0, false)).toEqual({ condition: 'Clear', symbol: 'moon' })
  })

  test('requires explicit coordinates', () => {
    expect(weatherConfig({})).toBeNull()
    expect(weatherConfig({ HERTHING_LATITUDE: '45', HERTHING_LONGITUDE: '-122' }))
      .toEqual({ latitude: 45, longitude: -122, unit: 'fahrenheit' })
  })

  test('normalizes an Open-Meteo response', async () => {
    const fakeFetch = async () => new Response(JSON.stringify({
      current: { temperature_2m: 71.4, weather_code: 2, is_day: 1, time: '2026-09-18T10:00' }
    }))
    expect(await fetchWeather({ latitude: 45, longitude: -122, unit: 'fahrenheit' }, fakeFetch))
      .toEqual({
        temperature: 71.4,
        unit: 'F',
        condition: 'Partly cloudy',
        symbol: 'partly-cloudy',
        observed_at: '2026-09-18T10:00',
        provider: 'open-meteo'
      })
  })
})
