import _, { groupBy, filter, map, sum, some, isUndefined, uniq, difference, flatMap, concat, mean, defaultTo, find, size } from 'lodash';
import { isPresent } from './util/Utils';
import { ServiceDependencyGraphPanelController } from '../panel/ServiceDependencyGraphPanelController';
import { GraphDataElement, IGraph, IGraphEdge, IGraphMetrics, IGraphNode, EGraphNodeType, GraphDataType } from '../types';

class GraphGenerator {

	controller: ServiceDependencyGraphPanelController;

	constructor(controller: ServiceDependencyGraphPanelController) {
		this.controller = controller;
	}

	_createNode(dataElements: GraphDataElement[]): IGraphNode | undefined {

		if (!dataElements || dataElements.length <= 0) {
			return undefined;
		}

		const sumMetrics = this.controller.getSettings().sumTimings;

		var nodeName = dataElements[0].target;
		if(nodeName === "" || nodeName === undefined || nodeName === null) {
			nodeName = "undefined"
		}
		
		const internalNode = some(dataElements, ['type', GraphDataType.INTERNAL]) || some(dataElements, ['type', GraphDataType.EXTERNAL_IN]);
		console.log(internalNode)
		const nodeType = internalNode ? EGraphNodeType.INTERNAL : EGraphNodeType.EXTERNAL;
		console.log(nodeType)

		const metrics: IGraphMetrics = {};
		
		const node: any = {
			data:{
				id: nodeName,
				label: nodeName,
				external_type: nodeType,
				type: nodeType,
				metrics,
			},
		};

		const aggregationFunction = sumMetrics ? sum : mean;
		console.log(dataElements)
		if (internalNode) {
			metrics.rate = sum(map(dataElements, element => element.data.rate_in));
			metrics.error_rate = sum(map(dataElements, element => element.data.error_rate_in));

			const response_timings = map(dataElements, element => element.data.response_time_in).filter(isPresent);
			if (response_timings.length > 0) {
				metrics.response_time = aggregationFunction(response_timings);
			}
		} else {
			metrics.rate = sum(map(dataElements, element => element.data.rate_out));
			metrics.error_rate = sum(map(dataElements, element => element.data.error_rate_out));

			const response_timings = map(dataElements, element => element.data.response_time_out).filter(isPresent);
			if (response_timings.length > 0) {
				metrics.response_time = aggregationFunction(response_timings);
			}

			const externalType = _(dataElements)
				.map(element => element.data.type)
				.uniq()
				.value();

			if (externalType.length == 1) {
				node.data.external_type = externalType[0];
			}
		}

		// metrics which are same for internal and external nodes
		metrics.threshold = _(dataElements)
			.map(element => element.data.threshold)
			.filter()
			.mean();

		if (sumMetrics) {
			const requestCount = defaultTo(metrics.rate, 0) + defaultTo(metrics.error_rate, 0);
			const response_time = defaultTo(metrics.response_time, -1);
			if (requestCount > 0 && response_time >= 0) {
				metrics.response_time = response_time / requestCount;
			}
		}

		const { rate, error_rate } = metrics;
		if (rate + error_rate > 0) {
			metrics.success_rate = 1.0 / (rate + error_rate) * rate;
		} else {
			metrics.success_rate = 1.0;
		}
		console.log(node)
		return node;
	}

	_createMissingNodes(data: GraphDataElement[], nodes: IGraphNode[]): IGraphNode[] {
		const existingNodeNames = map(nodes, node => node.data.id);
		const expectedNodeNames = uniq(flatMap(data, dataElement => [dataElement.source, dataElement.target])).filter(isPresent);
		const missingNodeNames = difference(expectedNodeNames, existingNodeNames);

		const missingNodes = map(missingNodeNames, name => {
			let nodeType: EGraphNodeType;
			let external_type: string | undefined;

			// derive node type
			let elementSrc = find(data, { source: name });
			let elementTrgt = find(data, { target: name });
			if (elementSrc && elementSrc.type == GraphDataType.EXTERNAL_IN) {
				nodeType = EGraphNodeType.EXTERNAL;
				external_type = elementSrc.data.type;
			} else if (elementTrgt && elementTrgt.type == GraphDataType.EXTERNAL_OUT) {
				nodeType = EGraphNodeType.EXTERNAL;
				external_type = elementTrgt.data.type
			} else {
				nodeType = EGraphNodeType.INTERNAL;
			}
			//TODO: UPDATE IGraphNode!!!!
			return <any>{
				data: {
					id: name,
					type: nodeType,
					external_type: external_type,
					metrics: {}
				}
			};
		});

		return missingNodes;
	}

	_createNodes(data: GraphDataElement[]): IGraphNode[] {
		var graphData = data.graph
		const filteredData = filter(graphData, dataElement => dataElement.source !== dataElement.target || (_.has(dataElement, "target") && !_.has(dataElement, "target")) || (!_.has(dataElement, "target") && _.has(dataElement, "target")));
	
		const targetGroups = groupBy(filteredData, 'target');
		
		const nodes = map(targetGroups, group => this._createNode(group)).filter(isPresent);
		
		// ensure that all nodes exist, even we have no data for them
		const missingNodes = this._createMissingNodes(filteredData, nodes);

		return concat(nodes, missingNodes);
	}

	_createEdge(dataElement: GraphDataElement): IGraphEdge | undefined {
		const { source, target } = dataElement;

		if (source === undefined || target === undefined) {
			console.error("source and target are necessary to create an edge", dataElement);
			return undefined;
		}

		const metrics: IGraphMetrics = {};

		//TODO Use IGraphEdge
		const edge: any = {
			data: {
				source,
				target,
				metrics
			},
		};

		const { rate_out, rate_in, error_rate_out, response_time_out } = dataElement.data;
		console.log(dataElement)
		if (!isUndefined(rate_out)) {
			metrics.rate = rate_out;
		} else if (!isUndefined(rate_in)) {
			metrics.rate = rate_in;
		}
		if (!isUndefined(error_rate_out)) {
			metrics.error_rate = error_rate_out;
		}
		if (!isUndefined(response_time_out)) {
			const { sumTimings } = this.controller.getSettings();

			if (sumTimings && metrics.rate) {
				metrics.response_time = response_time_out / metrics.rate;
			} else {
				metrics.response_time = response_time_out;
			}
		}


		return edge;
	}

	_createEdges(data: GraphDataElement[]): IGraphEdge[] {
		data = data.graph
		const filteredData = _(data)
			.filter(e => !!e.source)
			.filter(e => e.source !== e.target)
			.value();

		const edges = map(filteredData, element => this._createEdge(element));
		return edges.filter(isPresent);
	}

	_filterData(graph: IGraph): IGraph {
		const { filterEmptyConnections: filterData } = this.controller.getSettings();
		
		if (filterData) {
			const filteredGraph: IGraph = {
				nodes: [],
				edges: []
			};

			// filter empty connections
			filteredGraph.edges = filter(graph.edges, edge => size(edge.metrics) > 0);

			filteredGraph.nodes = filter(graph.nodes, node => {
				const name = node.name;

				// don't filter connected elements
				if (some(graph.edges, { 'source': name }) || some(graph.edges, { 'target': name })) {
					return true;
				}

				const metrics = node.metrics;
				if (!metrics) {
					return false; // no metrics
				}

				// only if rate, error rate or response time is available
				return defaultTo(metrics.rate, -1) >= 0
					|| defaultTo(metrics.error_rate, -1) >= 0
					|| defaultTo(metrics.response_time, -1) >= 0;
			});

			return filteredGraph;
		} else {
			return graph;
		}
	}

	generateGraph(graphData: GraphDataElement[]): IGraph {
		const filteredData = this._filterData(graphData);
		
		const nodes = this._createNodes(filteredData);

		const edges = this._createEdges(graphData);

		const graph: IGraph = {
			nodes,
			edges
		};
		
		const filteredGraph = this._filterData(graph);

		console.groupCollapsed('Graph generated');
		console.log('Input data:', graphData.graph);
		console.log('Nodes:', nodes);
		console.log('Edges:', edges);
		console.log('Filtered graph', filteredGraph);
		console.groupEnd();

		return filteredGraph;
	}
}

export default GraphGenerator;