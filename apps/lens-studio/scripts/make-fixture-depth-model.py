"""Write the tiny test-only depth model: depth = mean of the three normalized channels.

Same input/output names and shapes as the dynamic Depth Anything V2 export ("image" [1,3,H,W] ->
"depth" [1,H,W]); brighter pixels read as nearer. It lets browser tests run real onnxruntime-web
inference without the 99 MB model. Usage: python scripts/make-fixture-depth-model.py OUTPUT
"""
import sys

import onnx
from onnx import TensorProto, helper

image = helper.make_tensor_value_info('image', TensorProto.FLOAT, ['batch_size', 3, 'height', 'width'])
depth = helper.make_tensor_value_info('depth', TensorProto.FLOAT, ['batch_size', 'height', 'width'])
node = helper.make_node('ReduceMean', ['image'], ['depth'], axes=[1], keepdims=0)
graph = helper.make_graph([node], 'fixture-depth', [image], [depth])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)], producer_name='lens-studio-test-fixture')
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, sys.argv[1])
