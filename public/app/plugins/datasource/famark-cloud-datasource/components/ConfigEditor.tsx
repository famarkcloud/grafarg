import { AppEvents, DataSourcePluginOptionsEditorProps } from '@grafarg/data';
import { getBackendSrv } from '@grafarg/runtime';
import Api from '../api';
import {
  FieldValidationMessage,
  Button,
  DataSourceHttpSettings,
  InlineField,
  InlineFieldRow,
  InlineFormLabel,
  Input,
  RadioButtonGroup,
  TagsInput,
} from '@grafarg/ui';
import React, { ChangeEvent, useEffect, useState } from 'react';
import { JsonApiDataSourceOptions } from '../types';
import appEvents from 'app/core/app_events';

type Props = DataSourcePluginOptionsEditorProps<JsonApiDataSourceOptions>;

/** Auth mode options shown in the radio toggle */
const AUTH_MODE_OPTIONS = [
  { label: 'OAuth Forwarding', value: 'oauth' },
  { label: 'User / Password', value: 'userpass' },
  { label: 'Service Account', value: 'serviceaccount' },
];

const DEFAULT_BASE_URL = 'https://www.famark.com/Host/api.svc/';

/** Combine base URL + domain into a single URL */
const combinedUrl = (base: string, domain: string) => {
  const cleanBase = base.endsWith('/') ? base : base + '/';
  return domain ? cleanBase + domain : cleanBase;
};

/** ConfigEditor lets the user configure connection details like the URL or authentication. */
export const ConfigEditor: React.FC<Props> = ({ options, onOptionsChange }) => {
  const baseUrl = options.jsonData.baseUrl ?? DEFAULT_BASE_URL;
  const domainName = options.jsonData.domainName ?? '';

  // Auth mode
  const [authMode, setAuthMode] = useState<'oauth' | 'userpass' | 'serviceaccount'>(
    ((options.jsonData as any).authMode ?? 'oauth') as 'oauth' | 'userpass' | 'serviceaccount'
  );

  // User / Password state
  const [credUsername, setCredUsername] = useState<string>(((options.jsonData as any).credUsername ?? '') as string);
  const [credPassword, setCredPassword] = useState('');
  const [credStatus, setCredStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [credError, setCredError] = useState('');
  const [setCount, setSetCount] = useState(0);

  // Auth-mode switch saving state
  const [modeSwitchStatus, setModeSwitchStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [modeSwitchError, setModeSwitchError] = useState('');

  // Service Account state
  const [saTokenUrl, setSaTokenUrl] = useState<string>(((options.jsonData as any).saTokenUrl ?? '') as string);
  const [saClientId, setSaClientId] = useState<string>(((options.jsonData as any).saClientId ?? '') as string);
  const [saClientSecret, setSaClientSecret] = useState('');
  const [saAudience, setSaAudience] = useState<string>(
    ((options.jsonData as any).saAudience ?? 'http://localhost:3000') as string
  );
  const [saStatus, setSaStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [saError, setSaError] = useState('');

  // On mount: ensure URL + baseUrl are initialised, and default oauthPassThru
  // to true when authMode is 'oauth' and oauthPassThru hasn't been set yet.
  useEffect(() => {
    const currentCombined = options.url || combinedUrl(baseUrl, domainName);
    const currentAuthMode = (options.jsonData as any).authMode ?? 'oauth';
    const currentOAuthPassThru = (options.jsonData as any).oauthPassThru;

    // Only update if URL/baseUrl needs init OR oauthPassThru needs defaulting
    const needsUrlInit = !options.url || !options.jsonData.baseUrl;
    const needsOAuthDefault = currentAuthMode === 'oauth' && currentOAuthPassThru === undefined;

    if (needsUrlInit || needsOAuthDefault) {
      onOptionsChange({
        ...options,
        url: currentCombined,
        jsonData: {
          ...options.jsonData,
          baseUrl: options.jsonData.baseUrl ?? baseUrl,
          domainName: options.jsonData.domainName ?? domainName,
          // Default oauthPassThru to true for oauth mode if not already set
          ...(needsOAuthDefault ? { oauthPassThru: true } : {}),
        },
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // URL change handlers — never touch oauthPassThru
  const onBaseUrlChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newBase = e.currentTarget.value;
    onOptionsChange({
      ...options,
      url: combinedUrl(newBase, domainName),
      jsonData: { ...options.jsonData, baseUrl: newBase },
    });
  };

  const onDomainNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newDomain = e.currentTarget.value;
    onOptionsChange({
      ...options,
      url: combinedUrl(baseUrl, newDomain),
      jsonData: { ...options.jsonData, domainName: newDomain },
    });
  };

  const onParamsChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...options.jsonData, queryParams: e.currentTarget.value },
    });
  };

  // Helpers: fetch latest version to avoid 409 conflicts
  const fetchLatestVersion = async (): Promise<number | undefined> => {
    if (!options.id) {
      return options.version;
    }
    try {
      const current = await getBackendSrv().get(`/api/datasources/${options.id}`);
      return current.version;
    } catch (_) {
      return options.version;
    }
  };

  // Auth mode change.
  // When leaving userpass we MUST remove the SessionId header from the DB so the proxy
  // stops injecting it. We do a real PUT here and surface errors to the user.
  const onAuthModeChange = async (mode: 'oauth' | 'userpass' | 'serviceaccount') => {
    setAuthMode(mode);
    setCredStatus('idle');
    setCredError('');
    setSaStatus('idle');
    setSaError('');
    setModeSwitchStatus('idle');
    setModeSwitchError('');

    // We need to clear the custom header when leaving userpass OR serviceaccount,
    // because both modes store a token in httpHeaderValue1.
    const leavingUserPass = authMode === 'userpass' && mode !== 'userpass';
    const leavingServiceAccount = authMode === 'serviceaccount' && mode !== 'serviceaccount';
    const leavingTokenMode = leavingUserPass || leavingServiceAccount;

    // Build updated jsonData.
    // KEY: when leaving userpass/serviceaccount we delete httpHeaderName1 so the Grafarg proxy
    // no longer injects the old header — even if the encrypted value is still in DB.
    const updatedJsonData: any = {
      ...options.jsonData,
      authMode: mode,
      saTokenUrl: mode === 'serviceaccount' ? saTokenUrl : '',
      // Default the oauthPassThru toggle based on the selected mode:
      // Enable it for 'oauth' mode, disable for others. The user can still toggle it manually later.
      oauthPassThru: mode === 'oauth' ? true : false,
    };
    if (leavingTokenMode) {
      delete updatedJsonData.httpHeaderName1;
      delete updatedJsonData.credUsername;
    }

    // When leaving userpass/serviceaccount: mark secure fields as gone so the UI shows them cleared.
    // The backend will only truly delete them if we persist with a PUT below.
    const updatedSecureJsonFields: any = { ...options.secureJsonFields };
    if (leavingTokenMode) {
      updatedSecureJsonFields.httpHeaderValue1 = false;
      updatedSecureJsonFields.password = false;
      updatedSecureJsonFields.credPassword = false;
    }

    const updated: any = {
      ...options,
      jsonData: updatedJsonData,
      secureJsonFields: updatedSecureJsonFields,
      // Sending a placeholder value for the secrets tells the backend to overwrite them.
      // We use a single space so Grafana stores an effectively empty/invalid value,
      // while still triggering an update on the encrypted field.
      ...(leavingTokenMode
        ? {
            secureJsonData: {
              ...(options.secureJsonData ?? {}),
              httpHeaderValue1: ' ',
              password: ' ',
              credPassword: ' ',
            },
          }
        : {}),
    };

    onOptionsChange(updated);

    // Persist to DB so the Grafarg proxy stops sending the old header.
    if (options.id && leavingTokenMode) {
      setModeSwitchStatus('saving');
      try {
        const latestVersion = await fetchLatestVersion();
        const saved = await getBackendSrv().put(`/api/datasources/${options.id}`, {
          ...updated,
          version: latestVersion,
        });
        // Sync version so subsequent saves don't get a 409
        onOptionsChange({
          ...updated,
          version: saved?.datasource?.version ?? latestVersion,
          secureJsonFields: saved?.datasource?.secureJsonFields ?? updatedSecureJsonFields,
        });
        setModeSwitchStatus('idle');
        appEvents.emit(AppEvents.alertSuccess, ['Auth mode switched. Session cleared.']);
      } catch (err) {
        const msg =
          (err as any)?.data?.message ?? (err as any)?.message ?? 'Failed to save — please click Save & Test manually';
        setModeSwitchStatus('error');
        setModeSwitchError(msg);
        // Try to refresh the version so manual Save & Test can still succeed
        try {
          const current = await getBackendSrv().get(`/api/datasources/${options.id}`);
          onOptionsChange({ ...updated, version: current.version });
        } catch (_) {}
      }
    }
  };

  // User / Password: Connect with username + password, get SessionId, store as custom HTTP header
  const onConnectWithUserPass = async () => {
    const hasSavedSecret = Boolean(
      options.secureJsonFields?.password ||
        options.secureJsonFields?.credPassword ||
        options.secureJsonFields?.httpHeaderValue1
    );
    const needPassword = !credPassword && !hasSavedSecret;
    const missing = [!domainName && 'Domain Name', !credUsername && 'Username', needPassword && 'Password'].filter(
      Boolean
    );
    if (missing.length) {
      setCredError(`${missing.join(missing.length === 2 ? ' and ' : ', ')} required`);
      setCredStatus('error');
      return;
    }
    setCredStatus('loading');
    setCredError('');
    try {
      const latestVersion = await fetchLatestVersion();

      // Step 1: save current URL + jsonData to DB so proxy knows where to forward
      const opts: any = {
        ...options,
        version: latestVersion,
        url: combinedUrl(baseUrl, domainName),
        jsonData: {
          ...options.jsonData,
          baseUrl,
          domainName,
          // Do NOT touch oauthPassThru
          authMode: 'userpass',
          credUsername,
          saTokenUrl: '',
        },
      };
      if (options.id) {
        const saved = await getBackendSrv().put(`/api/datasources/${options.id}`, opts);
        opts.version = saved?.datasource?.version ?? opts.version;
      }

      // Step 2: call /Credential/Connect through the proxy if password is provided
      let sessionId: string | undefined;
      if (credPassword) {
        const body = JSON.stringify({ DomainName: domainName, UserName: credUsername, Password: credPassword });
        sessionId = await new Api('/api/datasources/proxy/' + options.id, '').get(
          'POST',
          '/Credential/Connect',
          [],
          [['Content-Type', 'application/json']],
          body,
          { hideFromInspector: true }
        );
      }

      // Step 3: save SessionId and Password in secureJsonData
      const finalSecureJsonData: any = { ...(options.secureJsonData ?? {}) };
      if (credPassword) {
        finalSecureJsonData.password = credPassword;
        finalSecureJsonData.credPassword = credPassword;
      }
      if (sessionId) {
        finalSecureJsonData.httpHeaderValue1 = sessionId;
      }

      const final: any = {
        ...opts,
        jsonData: { ...opts.jsonData, httpHeaderName1: 'SessionId' } as any,
        secureJsonData: finalSecureJsonData,
        secureJsonFields: {
          ...opts.secureJsonFields,
          ...(credPassword ? { password: true, credPassword: true } : {}),
          ...(sessionId ? { httpHeaderValue1: true } : {}),
        },
      };
      if (options.id) {
        const saved2 = await getBackendSrv().put(`/api/datasources/${options.id}`, final);
        final.version = saved2?.datasource?.version ?? final.version;
        if (saved2?.datasource?.secureJsonFields) {
          final.secureJsonFields = saved2.datasource.secureJsonFields;
        }
      }
      onOptionsChange(final);
      setCredPassword('');
      setCredStatus('idle');
      setSetCount((c) => c + 1);
      appEvents.emit(AppEvents.alertSuccess, ['Connected successfully']);
    } catch (err) {
      if (options.id) {
        try {
          const current = await getBackendSrv().get(`/api/datasources/${options.id}`);
          onOptionsChange({ ...options, version: current.version });
        } catch (_) {
          // ignore version sync failure
        }
      }
      setCredError((err as any)?.data?.ErrorMessage ?? (err as any)?.message ?? 'Connection failed');
      setCredStatus('error');
    }
  };

  // Service Account: fetch an access_token from Auth0 using client_credentials grant,
  // then store it as "Authorization: Bearer <token>" custom HTTP header.
  // The Grafarg proxy injects this header on every request to Famark.
  const onSaveServiceAccount = async () => {
    // Client secret is required every time because it cannot be read back after encryption.
    const missing = [
      !domainName && 'Domain Name',
      !saTokenUrl && 'Token URL',
      !saClientId && 'Client ID',
      !saClientSecret && 'Client Secret',
      !saAudience && 'Audience',
    ].filter(Boolean);
    if (missing.length) {
      setSaError(`${missing.join(missing.length === 2 ? ' and ' : ', ')} required`);
      setSaStatus('error');
      return;
    }

    setSaStatus('saving');
    setSaError('');
    try {
      const latestVersion = await fetchLatestVersion();

      // Step 1: Fetch an access_token from Auth0 using client_credentials grant.
      const tokenResp = await fetch(saTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: saClientId,
          client_secret: saClientSecret,
          audience: saAudience,
        }),
      });
      if (!tokenResp.ok) {
        let errMsg = 'Token endpoint returned ' + tokenResp.status;
        try {
          const errData = await tokenResp.json();
          errMsg += ': ' + (errData.error_description ?? errData.error ?? JSON.stringify(errData));
        } catch (_) {
          errMsg += ': ' + (await tokenResp.text());
        }
        throw new Error(errMsg);
      }
      const tokenData = await tokenResp.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        throw new Error('No access_token in token response');
      }

      // Step 2: Store the Bearer token as a custom HTTP header.
      // The Grafarg proxy automatically injects "Authorization: Bearer <token>" on every request.
      const final: any = {
        ...options,
        version: latestVersion,
        url: combinedUrl(baseUrl, domainName),
        jsonData: {
          ...options.jsonData,
          baseUrl,
          domainName,
          authMode: 'serviceaccount',
          saTokenUrl,
          saClientId,
          saAudience,
          oauthPassThru: false,
          httpHeaderName1: 'Authorization',
          credUsername: undefined,
        } as any,
        secureJsonData: {
          ...(options.secureJsonData ?? {}),
          httpHeaderValue1: `Bearer ${accessToken}`,
          password: ' ',
          credPassword: ' ',
        },
        secureJsonFields: {
          ...options.secureJsonFields,
          httpHeaderValue1: true,
          password: false,
          credPassword: false,
        },
      };
      if (options.id) {
        const saved = await getBackendSrv().put(`/api/datasources/${options.id}`, final);
        final.version = saved?.datasource?.version ?? final.version;
        if (saved?.datasource?.secureJsonFields) {
          final.secureJsonFields = saved.datasource.secureJsonFields;
        }
      }
      onOptionsChange(final);
      setSaClientSecret('');
      setSaStatus('idle');
      setSetCount((c) => c + 1);
      appEvents.emit(AppEvents.alertSuccess, ['Service Account connected successfully']);
    } catch (err) {
      if (options.id) {
        try {
          const current = await getBackendSrv().get(`/api/datasources/${options.id}`);
          onOptionsChange({ ...options, version: current.version });
        } catch (_) {
          // ignore version sync failure
        }
      }
      setSaError(
        (err as any)?.data?.ErrorMessage ?? (err as any)?.data?.message ?? (err as any)?.message ?? 'Connection failed'
      );
      setSaStatus('error');
    }
  };

  const combined = combinedUrl(baseUrl, domainName);
  const httpHeaderKey = `${(options.jsonData as any).httpHeaderName1 ?? 'none'}-${setCount}`;

  return (
    <>
      <h3 className="page-heading">HTTP</h3>
      <div className="gf-form-group">
        {/* URL */}
        <div className="gf-form">
          <InlineFieldRow>
            <InlineField label="URL" labelWidth={20} tooltip="Base API URL, e.g. https://www.famark.com/Host/api.svc/">
              <Input
                width={40}
                value={baseUrl}
                onChange={onBaseUrlChange}
                placeholder="https://www.famark.com/Host/api.svc/"
              />
            </InlineField>
          </InlineFieldRow>
        </div>

        {/* Domain Name */}
        <div className="gf-form">
          <InlineFieldRow>
            <InlineField label="Domain Name" labelWidth={20} tooltip="Your Famark domain, e.g. 'Starter'">
              <Input width={40} value={domainName} onChange={onDomainNameChange} placeholder="Starter" />
            </InlineField>
          </InlineFieldRow>
        </div>

        {/* Combined URL */}
        <div className="gf-form">
          <InlineFieldRow>
            <InlineField
              label="Combined URL"
              labelWidth={20}
              tooltip="The full URL sent to the API (Base URL + Domain)"
            >
              <Input width={40} value={combined} readOnly />
            </InlineField>
          </InlineFieldRow>
        </div>

        {/* Whitelisted Cookies */}
        {options.access !== 'direct' && (
          <div className="gf-form">
            <InlineFormLabel
              width={20}
              tooltip="Grafarg Proxy deletes forwarded cookies by default. Specify cookies by name that should be forwarded to the data source."
            >
              Whitelisted Cookies
            </InlineFormLabel>
            <TagsInput
              tags={options.jsonData.keepCookies}
              onChange={(cookies) =>
                onOptionsChange({ ...options, jsonData: { ...options.jsonData, keepCookies: cookies } })
              }
            />
          </div>
        )}

        {/* Auth Mode toggle */}
        <div className="gf-form">
          <InlineFormLabel
            width={20}
            tooltip="OAuth Forwarding: passes the signed-in user token. User/Password: fetches a SessionId from Famark. Service Account: uses OAuth2 Client Credentials with auto token refresh."
          >
            Auth Mode
          </InlineFormLabel>
          <RadioButtonGroup
            options={AUTH_MODE_OPTIONS}
            value={authMode}
            onChange={(v) => onAuthModeChange(v as 'oauth' | 'userpass' | 'serviceaccount')}
          />
        </div>

        {/* Auth mode switch status */}
        {modeSwitchStatus === 'saving' && (
          <div className="gf-form">
            <span className="gf-form-label">Clearing session...</span>
          </div>
        )}
        {modeSwitchStatus === 'error' && (
          <div className="gf-form">
            <FieldValidationMessage>
              {modeSwitchError + ' — please click Save & Test to finish clearing the session.'}
            </FieldValidationMessage>
          </div>
        )}

        {/* User / Password */}
        {authMode === 'userpass' && (
          <>
            <div className="gf-form">
              <InlineField label="Username" labelWidth={20}>
                <Input
                  width={40}
                  value={credUsername}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCredUsername(e.currentTarget.value)}
                  onBlur={() => {
                    onOptionsChange({
                      ...options,
                      jsonData: { ...options.jsonData, credUsername } as any,
                    });
                  }}
                  placeholder="Username"
                  autoComplete="username"
                />
              </InlineField>
            </div>

            <div className="gf-form">
              <InlineField
                label="Password"
                labelWidth={20}
                tooltip={
                  options.secureJsonFields?.password || options.secureJsonFields?.httpHeaderValue1
                    ? 'Password saved. Enter a new one to change.'
                    : 'Password used to fetch a SessionId from Famark. Stored encrypted.'
                }
              >
                <Input
                  width={40}
                  type="password"
                  value={credPassword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCredPassword(e.currentTarget.value)}
                  placeholder={
                    options.secureJsonFields?.password || options.secureJsonFields?.httpHeaderValue1
                      ? 'configured'
                      : 'Password'
                  }
                  autoComplete="current-password"
                />
              </InlineField>
            </div>

            <div className="gf-form">
              <Button variant="primary" size="sm" onClick={onConnectWithUserPass} disabled={credStatus === 'loading'}>
                {credStatus === 'loading' ? 'Connecting...' : 'Connect'}
              </Button>
            </div>

            {credStatus === 'error' && <FieldValidationMessage>{credError}</FieldValidationMessage>}
          </>
        )}

        {/* Service Account */}
        {authMode === 'serviceaccount' && (
          <>
            <div className="gf-form">
              <InlineField
                label="Token URL"
                labelWidth={20}
                tooltip="OAuth2 token endpoint, e.g. https://example.auth0.com/oauth/token"
              >
                <Input
                  width={40}
                  value={saTokenUrl}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setSaTokenUrl(e.currentTarget.value)}
                  onBlur={() => {
                    onOptionsChange({
                      ...options,
                      jsonData: { ...options.jsonData, saTokenUrl } as any,
                    });
                  }}
                  placeholder="https://example.auth0.com/oauth/token"
                />
              </InlineField>
            </div>

            <div className="gf-form">
              <InlineField label="Client ID" labelWidth={20} tooltip="OAuth2 Client ID for the service account">
                <Input
                  width={40}
                  value={saClientId}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setSaClientId(e.currentTarget.value)}
                  onBlur={() => {
                    onOptionsChange({
                      ...options,
                      jsonData: { ...options.jsonData, saClientId } as any,
                    });
                  }}
                  placeholder="your-client-id"
                />
              </InlineField>
            </div>

            <div className="gf-form">
              <InlineField
                label="Client Secret"
                labelWidth={20}
                tooltip="OAuth2 Client Secret. Required each time to fetch a fresh Bearer token. Not stored."
              >
                <Input
                  width={40}
                  type="password"
                  value={saClientSecret}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setSaClientSecret(e.currentTarget.value)}
                  placeholder="your-client-secret"
                  autoComplete="new-password"
                />
              </InlineField>
            </div>

            <div className="gf-form">
              <InlineField
                label="Audience"
                labelWidth={20}
                tooltip="Auth0 API Identifier (audience). Must match the API registered in Auth0, e.g. http://localhost:3000"
              >
                <Input
                  width={40}
                  value={saAudience}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setSaAudience(e.currentTarget.value)}
                  onBlur={() => {
                    onOptionsChange({
                      ...options,
                      jsonData: { ...options.jsonData, saAudience } as any,
                    });
                  }}
                  placeholder="http://localhost:3000"
                />
              </InlineField>
            </div>

            <div className="gf-form">
              <Button variant="primary" size="sm" onClick={onSaveServiceAccount} disabled={saStatus === 'saving'}>
                {saStatus === 'saving' ? 'Connecting...' : 'Connect'}
              </Button>
            </div>

            {saStatus === 'error' && <FieldValidationMessage>{saError}</FieldValidationMessage>}
          </>
        )}
      </div>

      <DataSourceHttpSettings
        key={httpHeaderKey}
        defaultUrl={DEFAULT_BASE_URL}
        hideHttpSection={true}
        dataSourceConfig={{
          ...options,
          url: combined,
          // Pass oauthPassThru as-is — user can freely toggle Forward OAuth Identity
          jsonData: { ...options.jsonData },
        }}
        onChange={(newOpts) => {
          const jd = newOpts.jsonData as JsonApiDataSourceOptions;

          // Detect if user deleted the SessionId header via the trash icon
          const sessionHeaderDeleted = !!(options.jsonData as any).httpHeaderName1 && !(jd as any).httpHeaderName1;

          // When the header is deleted, mark secure fields as cleared.
          // The actual DB update happens when the user clicks Save & Test.
          const updatedSecureJsonFields = sessionHeaderDeleted
            ? { ...newOpts.secureJsonFields, httpHeaderValue1: false, password: false, credPassword: false }
            : newOpts.secureJsonFields;

          onOptionsChange({
            ...newOpts,
            url: combinedUrl(jd.baseUrl ?? baseUrl, jd.domainName ?? domainName),
            jsonData: {
              ...jd,
              baseUrl: jd.baseUrl ?? baseUrl,
              domainName: jd.domainName ?? domainName,
              // Preserve user's oauthPassThru toggle — do NOT hardcode it
              oauthPassThru: jd.oauthPassThru,
            },
            secureJsonFields: updatedSecureJsonFields,
            // Overwrite secure values with a placeholder so the DB clears them on Save & Test
            ...(sessionHeaderDeleted
              ? {
                  secureJsonData: {
                    ...(newOpts.secureJsonData ?? {}),
                    httpHeaderValue1: ' ',
                    password: ' ',
                    credPassword: ' ',
                  },
                }
              : {}),
          });
        }}
      />

      <h3 className="page-heading">Misc</h3>
      <InlineFieldRow>
        <InlineField label="Query string" tooltip="Add a custom query string to your queries.">
          <Input
            width={50}
            value={options.jsonData.queryParams}
            onChange={onParamsChange}
            spellCheck={false}
            placeholder="page=1&limit=100"
          />
        </InlineField>
      </InlineFieldRow>
    </>
  );
};
