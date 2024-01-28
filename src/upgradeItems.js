export default function upgradeItems(json, type) {
	// change old versions for compatibility
	if (json.meds && type == 'treatments') {
		json.meds.forEach(item => {
			const info = item.info;
			const dur = info.duration;

			// change to int and to parse in ms instead of seconds
			if (typeof dur.start === 'string') {
				dur.start = +dur.start * 1000;
				// add duration.end if doesn't exist
				dur.end = +dur.end * 1000 || dur.start;
			}

			if (!info.lastUpdate) {
				info.lastUpdate = new Date().toISOString();
			}
		});
	}
} 