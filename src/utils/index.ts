export async function HTTPGet<T>(
    url: string,
    headers?: Record<string, string>,
): Promise<any> {
    let agent = null;
    // export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890
    const options: RequestInit = {
        method: 'GET',
        headers: headers,
        agent,
    } as any;

    const response: Response = await fetch(url, options);
    return await response.json();
}

export async function HTTPPost<T>(
  url: string,
  data: any,
  headers?: Record<string, string>,
): Promise<any> {
    const options: RequestInit = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
        body: JSON.stringify(data),
    };

    const response: Response = await fetch(url, options);
    return await response.json();
}

export async function querySubgraph(query: string, variables: any = {}) {
    const subgraphEndpoint = process.env['SubgraphEndpoint'];
    if (!subgraphEndpoint) {
        throw new Error('SubgraphEndpoint not found');
    }
    const response = await fetch(subgraphEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }
    const data = await response.json();
    return data.data;
}
