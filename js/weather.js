/* ---------------------------------------------------------
   weather.js — Open-Meteo, no API key, no account, no tracking.
   Coordinates are the République / Canal Saint-Martin area,
   deliberately rounded so no precise address is ever sent.
   --------------------------------------------------------- */

const Weather = (() => {
  /* Defaults to the Canal Saint-Martin area; Weather.setHome() overrides it
     from data/home.json so the forecast follows whoever lives here. */
  let LAT = 48.87, LON = 2.36;
  const url = () => `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${LAT}&longitude=${LON}`
    + `&current=temperature_2m,weather_code,precipitation`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`
    + `&timezone=Europe%2FParis&forecast_days=8`;

  // WMO weather interpretation codes
  const CODES = {
    0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
    45: ['Fog', '🌫️'], 48: ['Freezing fog', '🌫️'],
    51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
    61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
    66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
    71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
    80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Heavy showers', '⛈️'],
    85: ['Snow showers', '🌨️'], 86: ['Snow showers', '❄️'],
    95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm', '⛈️'], 99: ['Thunderstorm', '⛈️']
  };

  const describe = code => CODES[code] || ['—', '🌡️'];

  /* Turn a day's numbers into the mode the ranking engine uses. */
  function mode(tempMax, code, rainChance) {
    if (code >= 51 || rainChance >= 55) return 'rain';
    if (tempMax >= 30) return 'hot';
    if (tempMax <= 6)  return 'cold';
    if (code <= 2 && tempMax >= 16) return 'fine';
    return 'mixed';
  }

  const ADVICE = {
    rain:  'Rain about — favour museums, passages and workshops.',
    hot:   'Very warm — shade, water and evening plans win today.',
    cold:  'Cold — indoor culture and somewhere with a fire.',
    fine:  'Good weather — get outside while it lasts.',
    mixed: 'Mixed skies — keep a backup indoors.'
  };

  async function load() {
    const res = await fetch(url(), { cache: 'no-store' });
    if (!res.ok) throw new Error('weather ' + res.status);
    const d = await res.json();

    const days = d.daily.time.map((date, i) => {
      const tmax = Math.round(d.daily.temperature_2m_max[i]);
      const tmin = Math.round(d.daily.temperature_2m_min[i]);
      const code = d.daily.weather_code[i];
      const rain = d.daily.precipitation_probability_max[i] ?? 0;
      const [label, icon] = describe(code);
      return { date, tmax, tmin, code, rain, label, icon, mode: mode(tmax, code, rain) };
    });

    const [curLabel, curIcon] = describe(d.current.weather_code);
    return {
      now: {
        temp: Math.round(d.current.temperature_2m),
        label: curLabel,
        icon: curIcon
      },
      days,
      byDate: Object.fromEntries(days.map(x => [x.date, x])),
      advice: ADVICE[days[0].mode],
      mode: days[0].mode
    };
  }

  /* Round to two decimals — roughly a kilometre — so no exact address
     is ever sent to the weather service. */
  function setHome(lat, lon) {
    if (typeof lat === 'number' && typeof lon === 'number') {
      LAT = Math.round(lat * 100) / 100;
      LON = Math.round(lon * 100) / 100;
    }
  }

  return { load, setHome, ADVICE };
})();
