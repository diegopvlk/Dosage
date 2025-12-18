import { clockIs12, getDayLabel } from './locale.js';

const escapeHTML = str =>
	String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

/**
 * Get the treatments HTML file.
 *
 * @param {Object} treatments - Treatments JS Object
 */
export function getTreatmentsHTML(treatments) {
	const now = Date.now();

	const ongoingTreatments = [];
	const endedTreatments = [];

	const nonWhenNeededTreatments = treatments.filter(med => med.frequency !== 'when-needed');
	const whenNeededTreatments = treatments.filter(med => med.frequency === 'when-needed');

	nonWhenNeededTreatments.forEach(med => {
		if (med.duration.enabled && med.duration.end < now) {
			endedTreatments.push(med);
		} else {
			ongoingTreatments.push(med);
		}
	});

	const mapColorToCSS = color => {
		const colorMap = {
			blue: 'light-dark(#3584e4, #6ab9ff)',
			red: 'light-dark(#e62d42, #ff7077)',
			yellow: 'light-dark(#c88800, #eba93d)',
			purple: 'light-dark(#9141ac, #e391ff)',
			cyan: 'light-dark(#2190a4, #64c8dd)',
			green: 'light-dark(#3a944a, #57e389)',
			orange: 'light-dark(#ed5b00, #ff8542)',
			default: 'light-dark(#4a4a52, #dfe0eb)',
		};
		return colorMap[color];
	};

	const formatDate = timestamp => {
		return new Date(timestamp).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	};

	const formatDosage = (dosage, unit) => {
		return dosage
			.map(d => {
				const timeFmt = new Intl.DateTimeFormat(undefined, {
					hour: 'numeric',
					minute: 'numeric',
					hour12: clockIs12,
				});

				const time = new Date();
				time.setHours(d.time[0]);
				time.setMinutes(d.time[1]);

				// TRANSLATORS: Context: 1 Pill at 19:00
				return `<b>${d.dose} ${escapeHTML(unit)}</b> ${escapeHTML(_('at'))} ${timeFmt.format(
					time,
				)}`;
			})
			.join('<br>');
	};

	const createTreatmentGroupHTML = (title, treatmentsArray, isWhenNeeded, hasEnded = false) => {
		if (treatmentsArray.length === 0) return '';

		let html = `<div style="padding-top: 24px;">`;
		html += `<h2 style="margin-bottom: 8px; color: light-dark(#555, #ccc); break-before: page;">${escapeHTML(
			title,
		)}</h2>`;
		html += `<div style="display: flex; flex-wrap: wrap; gap: 12px;">`;

		treatmentsArray.forEach(med => {
			const cardColor = mapColorToCSS(med.color);
			const notes = med.notes
				? `<p style="font-style: italic; color: light-dark(#555, #aaa);"><b>${escapeHTML(
						_('Notes'),
				  )}:</b> ${escapeHTML(med.notes)}</p>`
				: '';

			let frequencyDisplay = '';
			switch (med.frequency) {
				case 'daily':
					frequencyDisplay = escapeHTML(_('Daily'));
					break;
				case 'specific-days':
					frequencyDisplay = med.days.map(day => getDayLabel(day, 'long')).join(', ');
					break;
				case 'day-of-month':
					frequencyDisplay = escapeHTML(_('Day of Month')) + ': ' + med.monthDay;
					break;
				case 'cycle':
					const daysActive = med.cycle[0];
					const daysInactive = med.cycle[1];
					frequencyDisplay = `${daysActive} ${escapeHTML(
						// TRANSLATORS: Context: 2 day(s) on, 1 day(s) off
						_('day(s) on'),
						// TRANSLATORS: Context: 2 day(s) on, 1 day(s) off
					)}, ${daysInactive} ${escapeHTML(_('day(s) off'))}`;
					break;
				default:
					frequencyDisplay = '';
			}

			let dosageHtml = '';
			let durationHtml = '';

			if (isWhenNeeded) {
				dosageHtml = `<p><b>${med.dosage[0].dose} ${escapeHTML(med.unit)}</b> ${escapeHTML(
					_('As Needed'),
				)}</p>`;
			} else {
				dosageHtml = `<p>${formatDosage(med.dosage, med.unit)}</p>`;

				if (med.duration.enabled) {
					const startDate = formatDate(med.duration.start);
					const endDate = formatDate(med.duration.end);
					durationHtml = `
						<p>
								<b>${escapeHTML(_('Duration'))}:</b><br>
								${
									hasEnded
										? `${escapeHTML(_('Started on'))} ${startDate}<br>`
										: `${escapeHTML(_('Start'))}: ${startDate}<br>`
								}
								${hasEnded ? `${escapeHTML(_('Ended on'))} ${endDate}` : ` ${escapeHTML(_('End'))}: ${endDate}`}
						</p>
					`;
				}
			}

			html += `
			<div style="
				border: 1px solid light-dark(#ccc, rgba(0,0,0,0.3));
				border-left: 5px solid ${cardColor};
				padding: 10px 10px 0 10px;
				border-radius: 12px;
				width: 286px;
				box-shadow: 2px 2px 8px light-dark(rgba(0,0,0,0.15), rgba(0,0,0,0.3));
				background-color: light-dark(#ffffff, #343437);
				color: light-dark(#000, #eee);
				break-inside: avoid;
			">
				<h3 style="margin-top: -4px; margin-bottom: 6px; color: light-dark(#333, #fff);">${escapeHTML(
					med.name,
				)}</h3> 
				<hr style="border: none; border-bottom: 1px solid light-dark(#ccc, #17171a); margin: 0 -10px 8px -10px;">
				<p>${hasEnded ? '' : `<b>${escapeHTML(frequencyDisplay)}</b>`}</p>
				${dosageHtml}
				${notes} 
				${durationHtml}
			</div>
		`;
		});

		html += `</div></div>`;

		return html;
	};

	let title = escapeHTML(_('Dosage')) + ' - ' + escapeHTML(_('Treatments'));
	let fullHTML = `
		<style>
			p {margin: 8px auto; font-size: 14px;}
			:root {color-scheme: light dark;}
			* {font-family: 'Adwaita Sans', Inter, Roboto, Arial, system-ui, sans-serif;font-feature-settings: 'tnum';}
			body {background-color: light-dark(#fafafb, #222226)}
		</style>
		<title>${title}</title><br>
		<div style="padding: 0 16px 16px 16px; color: light-dark(#000, #eee);"> 
		<h1>${title}</h1>
		<h2>${escapeHTML(_('Generated on')) + ' ' + formatDate(Date.now())}</h2>
	`;

	fullHTML += createTreatmentGroupHTML(escapeHTML(_('Ongoing')), ongoingTreatments, false);
	fullHTML += createTreatmentGroupHTML(escapeHTML(_('Non-scheduled')), whenNeededTreatments, true);
	fullHTML += createTreatmentGroupHTML(escapeHTML(_('Finished')), endedTreatments, false, true);

	fullHTML += `</div>`;

	return fullHTML;
}
