> ## Documentation Index
> Fetch the complete documentation index at: https://docs.jiekou.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Gemini 3.1 Flash 图片生成

使用 Gemini 3.1 Flash Image Preview 模型，通过文本提示词生成图片。支持可配置的图片尺寸、宽高比和思考深度以获取更高质量的生成结果。

## 请求头

<ParamField header="Content-Type" type="string" required={true}>
  枚举值: `application/json`
</ParamField>

<ParamField header="Authorization" type="string" required={true}>
  Bearer 身份验证格式: Bearer \{\{API 密钥}}。
</ParamField>

## 请求体

<ParamField body="size" type="string" default="1K">
  输出图片的像素尺寸（宽\*高）。0.5K（512px）仅适用于 Gemini 3.1 Flash。

  可选值：`0.5K`, `1K`, `2K`, `4K`
</ParamField>

<ParamField body="google" type="object">
  Google 搜索选项

  <Expandable title="properties" defaultOpen={true}>
    <ParamField body="web_search" type="boolean" default={false}>
      启用 Google 网页搜索，基于真实世界信息生成更准确的图片。
    </ParamField>

    <ParamField body="image_search" type="boolean" default={false}>
      启用 Google 图片搜索，使用真实图片作为生成的视觉参考。
    </ParamField>
  </Expandable>
</ParamField>

<ParamField body="prompt" type="string" required={true}>
  描述要生成图片的文本提示词
</ParamField>

<ParamField body="aspect_ratio" type="string" default="1:1">
  生成图片的宽高比。

  可选值：`1:1`, `1:4`, `1:8`, `2:3`, `3:2`, `3:4`, `4:1`, `4:3`, `4:5`, `5:4`, `8:1`, `9:16`, `16:9`, `21:9`
</ParamField>

<ParamField body="output_format" type="string" default="image/png">
  输出图片的 MIME 类型，支持 PNG 和 JPEG 格式。

  可选值：`image/png`, `image/jpeg`
</ParamField>

## 响应信息

<ResponseField name="image_urls" type="array" required={true}>
  生成的图片 URL 列表
</ResponseField>

<ResponseField name="grounding_metadata" type="object" required={false}>
  模型 grounding 元数据。Google 服务端工具（例如搜索）被调用时返回。注意：工具调用取决于 Google。参数启用工具，不一定 100% 触发工具调用。
</ResponseField>
