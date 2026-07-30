import { DataSourcePluginOptionsEditorProps } from '@grafarg/data';
import { DataSourceHttpSettings, InlineField, InlineFieldRow, InlineFormLabel, Input, TagsInput } from '@grafarg/ui';
import React, { ChangeEvent, useEffect } from 'react';
import { JsonApiDataSourceOptions } from '../types';

type Props = DataSourcePluginOptionsEditorProps<JsonApiDataSourceOptions>;

/** ConfigEditor lets the user configure connection details like the URL or authentication. */
export const ConfigEditor: React.FC<Props> = ({ options, onOptionsChange }) => {
  const baseUrl = options.jsonData.baseUrl ?? 'https://www.famark.com/Host/api.svc/api';
  const domainName = options.jsonData.domainName ?? '';
  const combinedUrl = (base: string, domain: string) => (base.endsWith('/') ? base : base + '/') + domain;

  // Keep Forward OAuth Identity always enabled.
  useEffect(() => {
    if (!options.jsonData.oauthPassThru) {
      onOptionsChange({ ...options, jsonData: { ...options.jsonData, oauthPassThru: true } });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onBaseUrlChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newBase = e.currentTarget.value;
    onOptionsChange({
      ...options,
      url: combinedUrl(newBase, domainName),
      jsonData: { ...options.jsonData, baseUrl: newBase, oauthPassThru: true },
    });
  };

  const onDomainNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newDomain = e.currentTarget.value;
    onOptionsChange({
      ...options,
      url: combinedUrl(baseUrl, newDomain),
      jsonData: { ...options.jsonData, domainName: newDomain, oauthPassThru: true },
    });
  };

  const onParamsChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...options.jsonData, queryParams: e.currentTarget.value },
    });
  };

  const combined = combinedUrl(baseUrl, domainName);

  return (
    <>
      <h3 className="page-heading">HTTP</h3>
      <div className="gf-form-group">
        <div className="gf-form">
          <InlineFieldRow>
            <InlineField
              label="URL"
              labelWidth={16}
              tooltip="Base API URL, e.g. https://www.famark.com/Host/api.svc/api/"
            >
              <Input
                width={40}
                value={baseUrl}
                onChange={onBaseUrlChange}
                placeholder="https://www.famark.com/Host/api.svc/api/"
              />
            </InlineField>
          </InlineFieldRow>
        </div>
        <div className="gf-form">
          <InlineFieldRow>
            <InlineField
              label="Domain Name"
              labelWidth={16}
              tooltip="Tenant/domain name appended to the base URL, e.g. MyDomain"
            >
              <Input width={40} value={domainName} onChange={onDomainNameChange} placeholder="MyDomain" />
            </InlineField>
          </InlineFieldRow>
        </div>
        <div className="gf-form">
          <InlineFieldRow>
            <InlineField
              label="Combined URL"
              labelWidth={16}
              tooltip="The full URL sent to the API (Base URL + Domain)"
            >
              <Input width={40} value={combined} readOnly />
            </InlineField>
          </InlineFieldRow>
        </div>
        {options.access !== 'direct' && (
          <div className="gf-form">
            <InlineFormLabel
              width={16}
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
      </div>

      <DataSourceHttpSettings
        defaultUrl="https://www.famark.com/Host/api.svc/api/"
        hideHttpSection={true}
        dataSourceConfig={{
          ...options,
          url: combined,
          jsonData: { ...options.jsonData, oauthPassThru: true },
        }}
        onChange={(newOpts) => {
          const jd = newOpts.jsonData as JsonApiDataSourceOptions;
          onOptionsChange({
            ...newOpts,
            url: combinedUrl(jd.baseUrl ?? baseUrl, jd.domainName ?? domainName),
            jsonData: {
              ...jd,
              baseUrl: jd.baseUrl ?? baseUrl,
              domainName: jd.domainName ?? domainName,
              oauthPassThru: true,
            },
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
