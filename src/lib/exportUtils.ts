/**
 * Exports data to a clean CSV file with UTF-8 BOM for perfect Excel Persian support.
 * Supports both object-based records and array-of-arrays signatures.
 */
export function exportToCsv(
  filename: string,
  arg2: any[] | Record<string, any>[],
  arg3?: any[] | { key: string; label: string }[]
) {
  let headerLine = '';
  let rowLines: string[] = [];

  if (Array.isArray(arg2) && typeof arg2[0] === 'string' && Array.isArray(arg3)) {
    // Signature: (filename, headerStrings, rowArrays)
    const headers = arg2 as string[];
    const rows = arg3 as (string | number)[][];
    headerLine = headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',');
    rowLines = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  } else if (Array.isArray(arg2) && Array.isArray(arg3)) {
    // Signature: (filename, rows, headers)
    const rows = arg2 as Record<string, any>[];
    const headers = arg3 as { key: string; label: string }[];
    headerLine = headers.map(h => `"${h.label.replace(/"/g, '""')}"`).join(',');
    rowLines = rows.map(row => {
      return headers.map(h => {
        const val = row[h.key] ?? '';
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',');
    });
  }

  const csvContent = '\uFEFF' + [headerLine, ...rowLines].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports full clinic backup to JSON file for offline and archival safety.
 */
export function exportClinicBackupToJson(filename: string, backupData: Record<string, any>) {
  const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(backupData, null, 2))}`;
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', jsonString);
  downloadAnchor.setAttribute('download', `${filename}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}
