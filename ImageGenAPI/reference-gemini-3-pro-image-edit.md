> ## Documentation Index
> Fetch the complete documentation index at: https://docs.jiekou.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Gemini 3 Pro 图片编辑

Gemini 3 Pro Image (Nano Banana Pro) 旨在通过集成最先进的推理能力，解决最具挑战性的图像生成任务。它是处理复杂和多轮图像生成与编辑的最佳模型，具备更高的准确性和更优的图像质量。支持 URL 和 Base64 编码的图片作为输入。

## 请求头

<ParamField header="Content-Type" type="string" required={true}>
  枚举值: `application/json`
</ParamField>

<ParamField header="Authorization" type="string" required={true}>
  Bearer 身份验证格式: Bearer \{\{API 密钥}}。
</ParamField>

## 请求体

<ParamField body="size" type="string" default="1K">
  输出图片的像素尺寸。1K（1024px）、2K（2048px）、4K（4096px）。默认为 1K

  可选值：`1K`, `2K`, `4K`
</ParamField>

<ParamField body="google" type="object">
  Google 搜索选项

  <Expandable title="properties" defaultOpen={true}>
    <ParamField body="web_search" type="boolean" default={false}>
      启用 Google 网页搜索，基于真实世界信息生成更准确的图片。
    </ParamField>
  </Expandable>
</ParamField>

<ParamField body="prompt" type="string" required={true}>
  描述期望图片编辑效果的文本提示词
</ParamField>

<ParamField body="image_urls" type="array">
  用于编辑的输入图片 URL 列表
</ParamField>

<ParamField body="aspect_ratio" type="string">
  输出图片的宽高比

  可选值：`1:1`, `3:2`, `2:3`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`
</ParamField>

<ParamField body="image_base64s" type="array">
  用于编辑的 Base64 编码图片列表
</ParamField>

## 响应信息

<ResponseField name="image_urls" type="array" required={true}>
  编辑后的图片 URL 列表
</ResponseField>

<ResponseField name="grounding_metadata" type="object" required={false}>
  模型 grounding 元数据。Google 服务端工具（例如搜索）被调用时返回。注意：工具调用取决于 Google。参数启用工具，不一定 100% 触发工具调用。
</ResponseField>
