import { basketballPublicView } from './site-view.mjs';

const version = document.querySelector('meta[name="basketball-publication"]')?.content;
const records = new Map();
export function siteRecord(path) {
  if (!/^[\da-f]{24}$/.test(version) || !/^[\w./-]+$/.test(path)) {
    return Promise.reject(Error('Basketball publication unavailable'));
  }
  if (!records.has(path)) {
    records.set(path, fetch('/basketball-data/' + version + '/' + path).then(response => {
      if (!response.ok) throw Error('Basketball display unavailable');
      return response.json();
    }).catch(error => {
      records.delete(path);
      throw error;
    }));
  }
  return records.get(path);
}

let render;
export async function publicView(url) {
  render ??= basketballPublicView(siteRecord, await siteRecord('index.json'));
  return render(url);
}

export async function viewDocument(url, signal) {
  if (!version) {
    const response = await fetch(url, {signal});
    if (!response.ok) throw Error('Basketball view unavailable');
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }
  const data = await publicView(url);
  if (!data?.markup) throw Error('Basketball view unavailable');
  return new DOMParser().parseFromString(data.markup, 'text/html');
}
