> ## Documentation Index
> Fetch the complete documentation index at: https://docs.jiekou.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# GPT Image 2 Text to Image

GPT Image 2 文生图生成模型的调用 API，支持多种质量等级（low/medium/high）和尺寸。根据文本提示词生成图像，可配置输出格式、压缩率和背景设置。

## 请求头

<ParamField header="Content-Type" type="string" required={true}>
  枚举值: `application/json`
</ParamField>

<ParamField header="Authorization" type="string" required={true}>
  Bearer 身份验证格式: Bearer \{\{API 密钥}}。
</ParamField>

## 请求体

<ParamField body="n" type="integer" default={1}>
  生成图片的数量，默认为 1。实际返回数量可能少于请求数量。

  取值范围：\[1, 10]
</ParamField>

<ParamField body="size" type="string" default="1024x1024">
  生成图片的尺寸。1024x1024 为正方形，1024x1536 为竖版，1536x1024 为横版，2048x2048 为2K正方形，2048x1152 为2K横版，3840x2160 为4K横版，2160x3840 为4K竖版，2048x1360 为3:2横版，1360x2048 为2:3竖版，1152x2048 为9:16竖版，2048x1536 为4:3横版，1536x2048 为3:4竖版，2048x880 为21:9超宽屏，880x2048 为9:21超竖屏，688x2048 为1:3竖版，2048x688 为3:1横版，2048x1024 为2:1横版，1024x2048 为1:2竖版。

  可选值：`1024x1024`, `1024x1536`, `1536x1024`, `2048x2048`, `2048x1152`, `3840x2160`, `2160x3840`, `2048x1360`, `1360x2048`, `1152x2048`, `2048x1536`, `1536x2048`, `2048x880`, `880x2048`, `688x2048`, `2048x688`, `2048x1024`, `1024x2048`, `auto`
</ParamField>

<ParamField body="prompt" type="string" required={true}>
  用于生成图像的文本提示词，支持中英文。最大长度 32000 个字符。

  长度限制：0 - 32000
</ParamField>

<ParamField body="quality" type="string" default="medium">
  生成图片的质量等级。low 速度最快、成本最低；medium 平衡质量与速度；high 质量最佳但速度最慢、成本最高。

  可选值：`low`, `medium`, `high`
</ParamField>

<ParamField body="background" type="string" default="auto">
  背景设置。

  可选值：`opaque`, `auto`
</ParamField>

<ParamField body="moderation" type="string" default="auto">
  内容审核等级。

  可选值：`low`, `auto`
</ParamField>

<ParamField body="output_format" type="string" default="png">
  输出图片的文件格式。

  可选值：`png`, `jpeg`
</ParamField>

<ParamField body="output_compression" type="integer">
  输出图片的压缩等级（0-100）。仅对 jpeg 格式有效，png 格式不支持（必须为 100 或不传）。

  取值范围：\[0, 100]
</ParamField>

## 响应信息

<ResponseField name="images" type="array" required={false}>
  生成的图片 URL 数组。
</ResponseField>
