import { clockIs12 } from './locale.js';

/**
 * Get the history CSV file.
 *
 * @param {Object} history - History JS Object
 * @param {boolean} isISO - Get with ISO date or not
 */
export function getHistoryCSV(history, isISO) {
	const header = [_('Date'), _('Time'), _('Name'), _('Dose'), _('Status'), _('Time Confirmed')];

	const rows = history.map(med => {
		const time = new Date();
		time.setHours(med.time[0]);
		time.setMinutes(med.time[1]);

		const timeString = time.toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: 'numeric',
			hour12: clockIs12,
		});

		const dateTaken = new Date(med.taken[0]);

		const dateString = isISO
			? dateTaken.toISOString().split('T')[0]
			: dateTaken.toLocaleDateString(undefined, {
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
			  });

		let timeConfirmedStr = '';

		let status;
		switch (med.taken[1]) {
			case -1:
				status = _('Missed');
				break;
			case 0:
				status = _('Skipped');
				break;
			case 1:
				status = _('Confirmed');
				timeConfirmedStr = new Date(med.taken[0]).toLocaleTimeString(undefined, {
					hour: 'numeric',
					minute: 'numeric',
					hour12: clockIs12,
				});
				break;
			case 2:
				status = _('Auto-Confirmed');
				break;
			case 3:
				status = _('Confirmed') + ` (${_('Time Unknown')})`;
				break;
		}

		const doseUnit = `${med.dose} ${med.unit}`;

		return [
			`"${dateString}"`,
			`"${timeString}"`,
			`"${med.name.replace(/"/g, '""')}"`,
			`"${doseUnit.replace(/"/g, '""')}"`,
			`"${status}"`,
			`"${timeConfirmedStr}"`,
		].join(',');
	});

	return [header.join(','), ...rows].join('\n');
}

/**
 * Get the history HTML file.
 *
 * @param {Object} history - History JS Object
 * @param {boolean} isISO - Get with ISO date or not
 */
export function getHistoryHTML(history, isISO) {
	const header = [_('Date'), _('Time'), _('Name'), _('Dose'), _('Status'), _('Time Confirmed')];

	const thead = `
	<thead>
			<tr>
					${header.map(label => `<th>${escapeHTML(label)}</th>`).join('')}
			</tr>
	</thead>`;

	const tbodyRows = history
		.map(med => {
			const time = new Date();
			time.setHours(med.time[0]);
			time.setMinutes(med.time[1]);

			const timeString = time.toLocaleTimeString(undefined, {
				hour: 'numeric',
				minute: 'numeric',
				hour12: clockIs12,
			});

			const dateTaken = new Date(med.taken[0]);
			const dateString = isISO
				? dateTaken.toISOString().split('T')[0]
				: dateTaken.toLocaleDateString(undefined, {
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
				  });

			let status;
			let timeConfirmedStr = '';
			let statusClass = '';

			switch (med.taken[1]) {
				case -1:
					status = _('Missed');
					statusClass = 'status-missed';
					break;
				case 0:
					status = _('Skipped');
					statusClass = 'status-skipped';
					break;
				case 1:
					status = _('Confirmed');
					statusClass = 'status-confirmed';
					timeConfirmedStr = new Date(med.taken[0]).toLocaleTimeString(undefined, {
						hour: 'numeric',
						minute: 'numeric',
						hour12: clockIs12,
					});
					break;
				case 2:
					status = _('Auto-Confirmed');
					statusClass = 'status-confirmed';
					break;
				case 3:
					status = _('Confirmed') + ` (${_('Time Unknown')})`;
					statusClass = 'status-confirmed';
					break;
			}

			const doseUnit = `${med.dose} ${med.unit}`;

			const cells = [dateString, timeString, med.name, doseUnit, status, timeConfirmedStr].map(
				escapeHTML,
			);

			const statusCell = `<td class="${statusClass}">${cells[4]}</td>`;

			return `
			<tr>
					<td>${cells[0]}</td>
					<td>${cells[1]}</td>
					<td>${cells[2]}</td>
					<td>${cells[3]}</td>
					${statusCell}
					<td>${cells[5]}</td>
			</tr>`;
		})
		.join('\n');

	const tbody = `<tbody>\n${tbodyRows}\n</tbody>`;

	const style = `
	<style>
		:root {
			color-scheme: light dark;
		}
		.history-table {
			width: 100%;
			border-collapse: collapse;
			font-family: 'Adwaita Sans', Inter, Roboto, Arial, system-ui, sans-serif;
			font-feature-settings: 'tnum';
			overflow-x: auto;
		}
		.history-table th,
		.history-table td {
			padding: 0.4rem;
			border: 1px solid light-dark(#77767B, #5E5C64);
		}
		.history-table thead th {
			background-color: light-dark(#5E5C64, #9A9996);
			color: light-dark(#FFFFFF, #000000);
			font-weight: 700;
			position: sticky;
			top: 0;
			z-index: 2;
		}
		.history-table tbody tr:nth-child(even) {
			background-color: light-dark(#F6F5F4, #2b2b2b);
		}
		.history-table tbody tr:hover {
			background-color: light-dark(#C0BFBC, #4c4c4c);
		}
		.status-missed   { color: light-dark(#C01C28, #ff6b6b); font-weight: 600; }
		.status-skipped  { color: light-dark(#3D3846, #DEDDDA); font-weight: 600; }
		.status-confirmed{ color: light-dark(#26A269, #2EC27E); font-weight: 600; }
	</style>`;

	return minifyHTML(`${style}
	<table class="history-table">
	${thead}
	${tbody}
	</table>`);
}

function escapeHTML(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function minifyHTML(html) {
	return html
		.replace(/\s+/g, ' ')
		.replace(/\s*(<[^>]+>)\s*/g, '$1')
		.trim();
}
