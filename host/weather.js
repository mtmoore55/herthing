const CONDITIONS = [
  [[0], 'Clear', 'sun'],
  [[1], 'Mostly clear', 'sun'],
  [[2], 'Partly cloudy', 'partly-cloudy'],
  [[3], 'Overcast', 'cloud'],
  [[45, 48], 'Fog', 'fog'],
  [[51, 53, 55, 56, 57], 'Drizzle', 'rain'],
  [[61, 63, 65, 66, 67], 'Rain', 'rain'],
  [[71, 73, 75, 77], 'Snow', 'snow'],
  [[80, 81, 82], 'Showers', 'rain'],
  [[85, 86], 'Snow showers', 'snow'],
  [[95, 96, 99], 'Thunderstorms', 'storm']
]

export function describeWeatherCode(code, isDay = true) {
  const match = CONDITIONS.find(([codes]) => codes.includes(Number(code)))
  if (!match) return { condition: 'Unknown', symbol: 'cloud' }
  const [, condition, symbol] = match
  return {
    condition,
    symbol: symbol === 'sun' && !isDay ? 'moon' : symbol
  }
}

export function weatherConfig(env = process.env) {
  const latitude = Number(env.HERTHING_LATITUDE)
  const longitude = Number(env.HERTHING_LONGITUDE)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('weather coordinates are outside valid latitude/longitude ranges')
  }
  return {
    latitude,
    longitude,
    unit: env.HERTHING_WEATHER_UNIT === 'celsius' ? 'celsius' : 'fahrenheit'
  }
}

export async function fetchWeather(config, fetchImpl = fetch) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.search = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    current: 'temperature_2m,weather_code,is_day',
    temperature_unit: config.unit,
    timezone: 'auto'
  })

  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`)
  const body = await response.json()
  const current = body.current
  if (!current || !Number.isFinite(current.temperature_2m)) {
    throw new Error('Open-Meteo response is missing current weather')
  }

  return {
    temperature: current.temperature_2m,
    unit: config.unit === 'celsius' ? 'C' : 'F',
    ...describeWeatherCode(current.weather_code, current.is_day === 1),
    observed_at: current.time || new Date().toISOString(),
    provider: 'open-meteo'
  }
}
