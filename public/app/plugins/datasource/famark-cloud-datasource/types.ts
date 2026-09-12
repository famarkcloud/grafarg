import { DataQuery, DataSourceJsonData, FieldType } from '@grafarg/data';

export type QueryLanguage = 'jsonpath' | 'jsonata';

export interface JsonField {
  name?: string;
  jsonPath: string;
  type?: FieldType;
  language?: QueryLanguage;
}

export type Pair<T, K> = [T, K];

export interface JsonApiQuery extends DataQuery {
  refId: string;
  fields: JsonField[];
  method: string;
  urlPath: string;
  queryParams: string;
  params: Array<Pair<string, string>>;
  headers: Array<Pair<string, string>>;
  body: string;
  cacheDurationSeconds: number;

  // Keep for backwards compatibility with older version of variables query editor.
  jsonPath?: string;

  // Experimental
  experimentalGroupByField?: string;
  experimentalMetricField?: string;
  experimentalVariableTextField?: string;
  experimentalVariableValueField?: string;
}

export const defaultQuery: Partial<JsonApiQuery> = {
  cacheDurationSeconds: 300,
  method: 'GET',
  queryParams: '',
  urlPath: '',
  fields: [{ jsonPath: '' }],
};

export interface JsonApiDataSourceOptions extends DataSourceJsonData {
  queryParams?: string;
  baseUrl?: string;
  domainName?: string;
  oauthPassThru?: boolean;
  keepCookies?: string[];

  // Auth mode: 'oauth' | 'userpass' | 'serviceaccount'
  authMode?: 'oauth' | 'userpass' | 'serviceaccount';

  // User/Password mode
  credUsername?: string;

  // Service Account (OAuth2 Client Credentials) mode — non-secret fields only
  // saClientSecret goes in secureJsonData (encrypted), not here
  saTokenUrl?: string;
  saClientId?: string;
  saAudience?: string; // Auth0 API Identifier, e.g. http://localhost:3000
}
