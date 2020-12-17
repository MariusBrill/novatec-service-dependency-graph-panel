import _ from 'lodash';

export function isPresent<T>(t: T | undefined | null | void): t is T {
	return t !== undefined && t !== null;
};

export default {

	getTemplateVariable: function (controller, variableName) {
		var templateVariable: any = _.find(controller.dashboard.templating.list, {
			name: variableName
		});
		if (templateVariable) {
			return templateVariable.current.value;
		} else {
			return undefined;
		}
	},

	getConfig: function (controller, configName) {
		console.log(controller.getSettings())
		console.log(configName)
		console.log(controller.getSettings().dataMapping[configName])
		return controller.getSettings().dataMapping[configName];
	},

	getTemplateVariableValues: function (controller, variableName) {
		var templateVariable: any = _.find(controller.dashboard.templating.list, {
			name: variableName
		});
		var options: any = templateVariable.model.options;
		return _.map(options, o => o.value);
	}

};
