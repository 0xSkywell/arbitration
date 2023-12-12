import axios from "axios";

export async function HTTPGet(
  url: string,
  options?: any,
): Promise<any> {
    let response: any;
    try {
        response = await axios.get(url, options);
    } catch (e) {
        console.error('request fail', url);
        throw new Error(e);
    }

    return await response.data;
}

export async function HTTPPost(
  url: string,
  data: any
): Promise<any> {
    const response = await axios.post(url, data);
    return await response.data;
}

export async function querySubgraph(query: string) {
    const subgraphEndpoint = process.env['SubgraphEndpoint'];
    if (!subgraphEndpoint) {
        throw new Error('SubgraphEndpoint not found');
    }
    return HTTPPost(subgraphEndpoint, { query });
}
