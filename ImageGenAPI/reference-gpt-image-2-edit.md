> ## Documentation Index
> Fetch the complete documentation index at: https://docs.jiekou.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# GPT Image 2 Image Edit

OpenAI GPT Image 2 图片编辑 API。根据文本提示词编辑图片，支持遮罩修复、透明背景，以及多种质量/尺寸选项。

## 请求头

<ParamField header="Content-Type" type="string" required={true}>
  枚举值: `application/json`
</ParamField>

<ParamField header="Authorization" type="string" required={true}>
  Bearer 身份验证格式: Bearer \{\{API 密钥}}。
</ParamField>

## 请求体

<ParamField body="n" type="integer" default={1}>
  生成的图片数量。实际返回数量可能少于请求数量。

  取值范围：\[1, 10]
</ParamField>

<ParamField body="mask" type="string">
  附加图片，其完全透明区域表示需要编辑的位置。必须是带有 alpha 通道的 PNG 格式。
</ParamField>

<ParamField body="size" type="string" default="1024x1024">
  生成图片的尺寸。

  可选值：`auto`, `688x2048`, `880x2048`, `1024x1024`, `1024x1536`, `1024x2048`, `1152x2048`, `1360x2048`, `1536x1024`, `1536x2048`, `2048x688`, `2048x880`, `2048x1024`, `2048x1152`, `2048x1360`, `2048x1536`, `2048x2048`, `2160x3840`, `3840x2160`
</ParamField>

<ParamField body="image" type="string" required={true}>
  要编辑的图片，可以是单张图片 URL/base64 或图片数组。支持格式：PNG、JPEG、GIF、WebP。
</ParamField>

<ParamField body="prompt" type="string" required={true}>
  描述所需编辑效果的文本提示词，最大长度为 32000 个字符。

  长度限制：0 - 32000
</ParamField>

<ParamField body="quality" type="string" default="low">
  生成图片的质量。质量越高耗时越长，费用越高。

  可选值：`low`, `medium`, `high`
</ParamField>

<ParamField body="background" type="string" default="auto">
  背景是否为不透明或自动检测。

  可选值：`opaque`, `auto`
</ParamField>

<ParamField body="output_format" type="string" default="png">
  输出图片格式。

  可选值：`png`, `jpeg`
</ParamField>

## 响应信息

<ResponseField name="images" type="array" required={false}>
  生成的图片 URL 数组。
</ResponseField>
