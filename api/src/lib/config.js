'use strict';
/* 모든 값은 Static Web Apps > 구성(환경 변수)에서 읽습니다. 코드에 비밀 값을 넣지 마세요. */
function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

module.exports = {
  get tenantId() { return env('TENANT_ID'); },
  get clientId() { return env('CLIENT_ID'); },
  get clientSecret() { return env('CLIENT_SECRET'); },
  get siteId() { return env('SITE_ID'); },
  get winnersListId() { return env('WINNERS_LIST_ID'); },
  get settingsListId() { return env('SETTINGS_LIST_ID'); },
  get mailFrom() { return env('MAIL_FROM'); },
  get authority() { return env('AUTHORITY_HOST', 'https://login.microsoftonline.com'); },
  get graphBase() { return env('GRAPH_BASE', 'https://graph.microsoft.com/v1.0'); },
  isConfigured() {
    return ['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SITE_ID', 'WINNERS_LIST_ID', 'SETTINGS_LIST_ID']
      .every((k) => env(k));
  },
};
