export interface EndpointParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
  enumValues?: string[];
}

export interface CodeExamples {
  curl: string;
  javascript: string;
  python?: string;
}

export interface EndpointDef {
  id: string;
  method: "query" | "mutation";
  path: string;
  title: string;
  description: string;
  /** public = no auth needed; protected = session required; business = session + businessId header required */
  auth: "public" | "protected" | "business";
  /** Minimum role required when auth is 'business' */
  requiredRole?: "viewer" | "member" | "admin";
  input: EndpointParam[];
  output: {
    description: string;
    example: unknown;
  };
  codeExamples: CodeExamples;
  gotchas?: string[];
  relatedEndpoints?: string[];
}

export interface EndpointGroup {
  id: string;
  title: string;
  description: string;
  endpoints: EndpointDef[];
}

export interface EndpointSection {
  id: string;
  title: string;
  groups: EndpointGroup[];
}
