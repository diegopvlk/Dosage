/* 
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only 
 */
'use strict';

import GObject from 'gi://GObject';

export const MedicationObject = GObject.registerClass({
	GTypeName: 'MedicationObject',
	Properties: {
		obj: GObject.ParamSpec.jsobject(
			'obj',
			'Medication',
			'Medication Object',
			GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
			{}
		)
	},
},
class extends GObject.Object {
	get obj() {
		return this._obj;
	}
	set obj(obj) {
		if (this._obj === obj) return;
		this._obj = obj;
		this.notify('obj');
	}
});
